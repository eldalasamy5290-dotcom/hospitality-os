import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { z } from "zod";

import { supabase } from "./lib/supabase";
import { processIncomingEmail } from "./ai/emailProcessor";
import { extractBookingFromText } from "./ai/bookingExtract";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { functionKnowledgeDemo } from "./ai/functionKnowledge";
import { eligibleMenus, estimateRevenue, buildFunctionEmailDraft } from "./ai/functionEngine";
import { sendMailViaGraph } from "./lib/graphMail";
import { spawn } from "child_process";

const app = express();

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/demo", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.use(cors());
app.use(express.json());

// Microsoft Graph webhook (validation + notifications)
app.get("/webhooks/outlook", (req, res) => {
  const token = (req.query as any)?.validationToken as string | undefined;
  if (token) return res.status(200).send(token); // plain text required
  return res.sendStatus(200);
});

app.post("/webhooks/outlook", (req, res) => {
  const token = (req.query as any)?.validationToken as string | undefined;
  if (token) return res.status(200).send(token); // validation

  // ACK fast
  res.sendStatus(202);

  console.log("Outlook webhook notification received");

  // Debounce: avoid spawning many runners in a burst
  try {
    const lockPath = path.join(process.cwd(), "data", "outlook_trigger.lock");
    const now = Date.now();

    let last = 0;
    if (fs.existsSync(lockPath)) {
      last = Number(fs.readFileSync(lockPath, "utf-8") || "0");
    }

    // if last trigger was within 15s, skip
    if (now - last < 15000) return;

    fs.writeFileSync(lockPath, String(now));

    spawn("node", ["src/runOutlookPoll.js"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "ignore",
      detached: true,
    }).unref();
  } catch (e) {
    console.error("Failed to trigger delta runner:", e);
  }
});

// Trigger async: run delta sync + ingest
if (process.env.RUN_POLL_ON_BOOT === "true") {
 spawn("node", ["src/runOutlookPoll.js"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "ignore",
  detached: true,
}).unref();
}

const IngestEmailSchema = z.object({
  restaurant_id: z.string().uuid(),
  customer_email: z.string().email(),
  customer_name: z.string().optional(),
  thread_id: z.string().optional(),
  message_text: z.string().min(3),
  email_event: z.any().optional(),
}).passthrough();

app.post("/ingest/email", async (req, res) => {
  const parsed = IngestEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const p = parsed.data;

// 1) AI processing
const now_perth_iso = new Date().toISOString();

const result = await processIncomingEmail({
  now_perth_iso,
  message_text: p.message_text,
});

// if function → save inbox_event + create function draft (+ revenue) + stop
if (result.type === "function") {
  const emailEvent = (p as any).email_event ?? null;

  // 1) Save inbox_event (log)
  const { data: savedEvent, error: evErr } = await supabase
    .from("inbox_events")
    .insert([
      {
        restaurant_id: p.restaurant_id,
        provider: emailEvent?.provider ?? "api",
        message_id: emailEvent?.message_id ?? null,
        thread_id: emailEvent?.thread_id ?? p.thread_id ?? null,
        from_email: emailEvent?.from ?? p.customer_email ?? null,
        subject: emailEvent?.subject ?? null,
        body_preview: emailEvent?.body ?? p.message_text?.slice(0, 500) ?? null,
        received_at: emailEvent?.received_at ?? null,
        classified_type: "function",
        classified_confidence: result.confidence,
        raw_event: emailEvent,
      },
    ])
    .select("id,thread_id,created_at")
    .single();

  if (evErr) return res.status(500).json({ ok: false, error: evErr.message });

  // 2) Create function proposal draft (+ revenue estimate)
  const restaurantName = "Bungalow"; // demo

  const extract = {
    people: (result as any)?.function_data?.people ?? null,
    date_hint: (result as any)?.function_data?.date_hint ?? null,
    occasion: (result as any)?.function_data?.occasion ?? "function",
    notes: null,
  };

  let eligible: any[] = [];
  let revenue: any = null;

if (extract.people) {
  eligible = eligibleMenus(functionKnowledgeDemo as any, extract.people);

  const chosen = eligible.find((m: any) => typeof m.price_pp === "number" && m.price_pp !== null);

  if (chosen?.price_pp) {
    revenue = estimateRevenue({
      people: extract.people,
      chosenMenuPricePP: chosen.price_pp,
      drinksEstimatePP: functionKnowledgeDemo.drinks_estimate_pp,
    });

    // -------- DASHBOARD METRIC --------
    await supabase.from("outbox_actions").insert([
      {
        restaurant_id: p.restaurant_id,
        provider: "internal",
        action_type: "function_estimate",
        thread_id: emailEvent?.thread_id ?? p.thread_id ?? null,
        payload: {
          people: extract.people,
          food: revenue.food,
          drinks: revenue.drinks,
          total: revenue.total,
        },
      },
    ]);
  }
}

  const draftEmail = buildFunctionEmailDraft({
    restaurantName,
    extract,
    eligible,
    add_ons: functionKnowledgeDemo.add_ons,
  });

  const internalHeader =
    revenue
      ? `INTERNAL EVENT ESTIMATE\nGuests: ${extract.people}\nFood: $${revenue.food}\nDrinks (est): $${revenue.drinks}\nTotal (est): $${revenue.total}\n\n---\n\n`
      : `INTERNAL EVENT ESTIMATE\nGuests: ${extract.people ?? "unknown"}\nTotal (est): unknown\n\n---\n\n`;

  const finalBody = internalHeader + draftEmail.body;

  const { data: savedDraft, error: dErr } = await supabase
    .from("draft_replies")
    .insert([
      {
        restaurant_id: p.restaurant_id,
        thread_id: savedEvent?.thread_id ?? (p.thread_id ?? null),
        to_email: (emailEvent?.from ?? p.customer_email) ?? null,
        subject: draftEmail.subject,
        body: finalBody,
        status: "draft",
      },
    ])
    .select("id,thread_id,status,created_at")
    .single();

  if (dErr) return res.status(500).json({ ok: false, error: dErr.message });

  return res.status(200).json({
    ok: true,
    type: "function",
    confidence: result.confidence,
    inbox_event: savedEvent,
    draft: savedDraft,
    estimate: revenue,
  });
}

// if not booking and not function → save inbox_event and stop
if (result.type !== "booking") {
  const emailEvent = (p as any).email_event ?? null;

  const { data: saved, error: evErr } = await supabase
    .from("inbox_events")
    .insert([
      {
        restaurant_id: p.restaurant_id,
        provider: emailEvent?.provider ?? "api",
        message_id: emailEvent?.message_id ?? null,
        thread_id: emailEvent?.thread_id ?? p.thread_id ?? null,
        from_email: emailEvent?.from ?? p.customer_email ?? null,
        subject: emailEvent?.subject ?? null,
        body_preview: emailEvent?.body ?? p.message_text?.slice(0, 500) ?? null,
        received_at: emailEvent?.received_at ?? null,
        classified_type: result.type,
        classified_confidence: result.confidence,
        raw_event: emailEvent,
      },
    ])
    .select("id,classified_type,classified_confidence,created_at")
    .single();

  if (evErr) return res.status(500).json({ ok: false, error: evErr.message });

  return res.status(200).json({
    ok: true,
    type: result.type,
    confidence: result.confidence,
    inbox_event: saved,
  });
}

const extracted = result.booking!;
const emailEvent = (p as any).email_event ?? null;

const { error: bookingInboxErr } = await supabase
  .from("inbox_events")
  .insert([
    {
      restaurant_id: p.restaurant_id,
      provider: emailEvent?.provider ?? "api",
      message_id: emailEvent?.message_id ?? null,
      thread_id: emailEvent?.thread_id ?? p.thread_id ?? null,
      from_email: emailEvent?.from ?? p.customer_email ?? null,
      subject: emailEvent?.subject ?? null,
      body_preview: emailEvent?.body ?? p.message_text?.slice(0, 500) ?? null,
      received_at: emailEvent?.received_at ?? null,
      classified_type: "booking",
      classified_confidence: result.confidence,
      raw_event: emailEvent,
    },
  ]);

if (bookingInboxErr) {
  return res.status(500).json({ ok: false, error: bookingInboxErr.message });
}

  // 2) upsert customer
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .upsert(
      [{ restaurant_id: p.restaurant_id, email: p.customer_email, name: p.customer_name ?? null }],
      { onConflict: "restaurant_id,email" }
    )
    .select("id,email,name")
    .single();

  if (custErr) return res.status(500).json({ ok: false, error: custErr.message });

  // 4) check existing booking by thread_id
  let existingBooking: any = null;

  if (p.thread_id) {
    const { data: foundBooking, error: findErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("restaurant_id", p.restaurant_id)
      .eq("thread_id", p.thread_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) {
      return res.status(500).json({ ok: false, error: findErr.message });
    }

    existingBooking = foundBooking;
  }
 
  // 3) backend rules for status
  let final_booking_date_iso = existingBooking?.booking_date_iso ?? null;

  if (extracted.booking_date_iso) {
  // aggiorna solo se non esiste già una data
  if (!existingBooking?.booking_date_iso) {
    final_booking_date_iso = extracted.booking_date_iso;
  }
}
  const final_time =
    extracted.time ?? existingBooking?.time ?? null;

  const final_people =
    extracted.people ?? existingBooking?.people ?? null;

  const final_dietary =
    extracted.dietary ?? existingBooking?.dietary ?? null;

  const final_occasion =
    extracted.occasion ?? existingBooking?.occasion ?? null;

  const missing: string[] = [];
  if (!final_booking_date_iso) missing.push("date");
  if (!final_time) missing.push("time");
  if (!final_people) missing.push("people");
    
  const status = missing.length > 0 ? "needs_info" : "pending";  

 // 4) create booking

  let booking: any = null;
  let bookErr: any = null;

  if (existingBooking) {
    const mergedHistory = [
      ...(Array.isArray(existingBooking.history) ? existingBooking.history : []),
      {
        ts: new Date().toISOString(),
        event: "ingest_email_update",
        intent: extracted.intent,
        missing,
        message_preview: p.message_text.slice(0, 120),
      },
    ];

    const { data: updatedBooking, error: updateErr } = await supabase
      .from("bookings")
      .update({
        customer_id: customer.id,
        time: extracted.time ?? existingBooking.time,
        people: extracted.people ?? existingBooking.people,
        dietary: extracted.dietary ?? existingBooking.dietary,
        occasion: extracted.occasion ?? existingBooking.occasion,
        booking_date_iso: final_booking_date_iso,
        time: final_time,
        people: final_people,
        dietary: final_dietary,
        occasion: final_occasion,
        status,
        confidence: extracted.confidence ?? existingBooking.confidence,
        history: mergedHistory,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingBooking.id)
      .select("*")
      .single();

    booking = updatedBooking;
    bookErr = updateErr;
  } else {
    const { data: createdBooking, error: createErr } = await supabase
      .from("bookings")
      .insert([
        {
          restaurant_id: p.restaurant_id,
          customer_id: customer.id,
          thread_id: p.thread_id ?? null,
          source: "email",
          booking_date_iso: final_booking_date_iso,
          time: final_time,
          people: final_people,
          dietary: final_dietary,
          occasion: final_occasion,
          status,
          confidence: extracted.confidence,
          history: [
            {
              ts: new Date().toISOString(),
              event: "ingest_email",
              intent: extracted.intent,
              missing,
              message_preview: p.message_text.slice(0, 120),
            },
          ],
          ai_notes: null,
        },
      ])
      .select("*")
      .single();

    booking = createdBooking;
    bookErr = createErr;
  }

  if (bookErr) {
    return res.status(500).json({ ok: false, error: bookErr.message });
  }


// -------- DEMO: create draft reply --------
let replyBody = "";

if (missing.length === 0) {
  replyBody = `Hi,

Thanks for your booking request.

We received your booking for ${final_people} people on ${final_booking_date_iso} at ${final_time}.

Your reservation is currently pending confirmation.

Best regards`;
} else {
  replyBody = `Hi,

Thanks for your message.

To complete your booking we still need: ${missing.join(", ")}.

Please reply with the missing information.

Best regards`;
}


const threadIdForDraft = p.thread_id ?? null;

let existingDraft: any = null;

if (threadIdForDraft) {
  const { data: draftRows, error: searchDraftErr } = await supabase
    .from("draft_replies")
    .select("*")
    .eq("restaurant_id", p.restaurant_id)
    .eq("thread_id", threadIdForDraft)
    .eq("status", "draft")
    .limit(1);

  if (searchDraftErr) {
    return res.status(500).json({ ok: false, error: searchDraftErr.message });
  }

  existingDraft = draftRows?.[0] ?? null;
}

if (existingDraft) {
  const { error: updateDraftErr } = await supabase
    .from("draft_replies")
    .update({
      to_email: p.customer_email,
      subject: "Re: booking request",
      body: replyBody,
      message_id: emailEvent?.message_id ?? existingDraft.message_id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingDraft.id);

  if (updateDraftErr) {
    return res.status(500).json({ ok: false, error: updateDraftErr.message });
  }
} else {
  const { error: insertDraftErr } = await supabase
    .from("draft_replies")
    .insert([
      {
        restaurant_id: p.restaurant_id,
        thread_id: threadIdForDraft,
        message_id: emailEvent?.message_id ?? null,
        to_email: p.customer_email,
        subject: "Re: booking request",
        body: replyBody,
        status: "draft",
      },
    ]);

  if (insertDraftErr) {
    return res.status(500).json({ ok: false, error: insertDraftErr.message });
  }
}

  
if (existingDraft) {
  const { error: updateDraftErr } = await supabase
    .from("draft_replies")
    .update({
      to_email: p.customer_email,
      subject: "Re: booking request",
      body: replyBody,
      message_id: emailEvent?.message_id ?? existingDraft.message_id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existingDraft.id);

  if (updateDraftErr) {
    return res.status(500).json({ ok: false, error: updateDraftErr.message });
  }
} else {
  const { error: insertDraftErr } = await supabase
    .from("draft_replies")
    .insert([
      {
        restaurant_id: p.restaurant_id,
        booking_id: booking.id,
        to_email: p.customer_email,
        subject: "Re: booking request",
        body: replyBody,
        status: "draft",
        message_id: emailEvent?.message_id ?? null,
      },
    ]);

  if (insertDraftErr) {
    return res.status(500).json({ ok: false, error: insertDraftErr.message });
  }
}

// -------- DEMO: create outbox action (NowBookIt shadow mode) --------
if (missing.length === 0) {
  const threadIdForAction = p.thread_id ?? null;

  let existingAction: any = null;

  if (threadIdForAction) {
    const { data: foundAction, error: findActionErr } = await supabase
      .from("outbox_actions")
      .select("*")
      .eq("restaurant_id", p.restaurant_id)
      .eq("thread_id", threadIdForAction)
      .eq("provider", "nowbookit")
      .eq("action_type", "create_booking")
      .in("status", ["queued", "approved", "processing"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findActionErr) {
      return res.status(500).json({ ok: false, error: findActionErr.message });
    }

    existingAction = foundAction;
  }

  if (!existingAction) {
    const { error: insertActionErr } = await supabase
      .from("outbox_actions")
      .insert([
        {
          restaurant_id: p.restaurant_id,
          provider: "nowbookit",
          action_type: "create_booking",
          thread_id: threadIdForAction,
          payload: {
            booking_date_iso: final_booking_date_iso,
            time: final_time,
            people: final_people,
            name: p.customer_name ?? null,
            email: p.customer_email,
          },
        },
      ]);

    if (insertActionErr) {
      return res.status(500).json({ ok: false, error: insertActionErr.message });
    }
  }
}

  return res.status(201).json({ ok: true, extracted, booking });
});




app.get("/", (req, res) => {
  res.json({ message: "HospitalityOS backend running 🚀", status: "ok" });
});

app.get("/health/db", async (req, res) => {
  const { data, error } = await supabase.from("restaurants").select("id").limit(1);
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? [] });
});

app.get("/routes", (req, res) => {
  res.json({
    ok: true,
    routes: [
      "GET /",
      "GET /health/db",
      "GET /routes",
      "POST /restaurants",
      "POST /bookings",
      "POST /ai/extract-booking",
    ],
  });
});

app.get("/dashboard", async (req, res) => {
  const restaurant_id = String(req.query.restaurant_id ?? "");
  if (!restaurant_id) return res.status(400).json({ ok: false, error: "restaurant_id required" });

  // Today range (UTC ok for demo; poi lo rendiamo Perth strict)
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date();
  end.setUTCHours(23, 59, 59, 999);

  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // Emails processed today
  const { count: emailsCount, error: e1 } = await supabase
    .from("inbox_events")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant_id)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (e1) return res.status(500).json({ ok: false, error: e1.message });

  // Bookings created today
  const { count: bookingsCount, error: e2 } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant_id)
    .eq("source", "email")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (e2) return res.status(500).json({ ok: false, error: e2.message });

  // Draft replies pending today (or total - demo: today)
  const { count: draftsPending, error: e5 } = await supabase
    .from("draft_replies")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant_id)
    .eq("status", "draft")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (e5) return res.status(500).json({ ok: false, error: e5.message });

  // Outbox actions pending today (NowBookIt shadow)
  const { count: actionsPending, error: e6 } = await supabase
    .from("outbox_actions")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant_id)
    .in("status", ["queued", "approved", "processing"])
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (e6) return res.status(500).json({ ok: false, error: e6.message });


  // Function leads today
  const { count: functionCount, error: e3 } = await supabase
    .from("inbox_events")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurant_id)
    .eq("classified_type", "function")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (e3) return res.status(500).json({ ok: false, error: e3.message });

  // Estimated revenue today (sum payload.total)
  const { data: estimates, error: e4 } = await supabase
    .from("outbox_actions")
    .select("payload,created_at")
    .eq("restaurant_id", restaurant_id)
    .eq("provider", "internal")
    .eq("action_type", "function_estimate")
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (e4) return res.status(500).json({ ok: false, error: e4.message });

  const estimatedRevenue = (estimates ?? []).reduce((sum: number, row: any) => {
    const t = Number(row?.payload?.total ?? 0);
    return sum + (Number.isFinite(t) ? t : 0);
  }, 0);

  return res.json({
    ok: true,
    restaurant_id,
    range: { start: startIso, end: endIso },
    metrics: {
      emails_processed: emailsCount ?? 0,
      bookings_created: bookingsCount ?? 0,
      function_leads: functionCount ?? 0,
      estimated_revenue: estimatedRevenue,
      drafts_pending: draftsPending ?? 0,
      actions_pending: actionsPending ?? 0,    
},
  });
});

app.get("/dashboard/timeline", async (req, res) => {
  const restaurant_id = String(req.query.restaurant_id ?? "");
  const limit = Math.min(Number(req.query.limit ?? 10), 50);

  if (!restaurant_id) {
    return res.status(400).json({ ok: false, error: "restaurant_id required" });
  }

  // Prendiamo più righe da ogni tabella, poi facciamo merge+sort.
  // (es: limit*2 per stare larghi)
  const perTable = Math.min(limit * 2, 50);

  const [inbox, bookings, drafts, actions] = await Promise.all([
    supabase
      .from("inbox_events")
      .select("id,created_at,classified_type,classified_confidence,from_email,subject,thread_id,provider")
      .eq("restaurant_id", restaurant_id)
      .order("created_at", { ascending: false })
      .limit(perTable),

    supabase
      .from("bookings")
      .select("id,created_at,status,people,booking_date_iso,time,thread_id,source")
      .eq("restaurant_id", restaurant_id)
      .order("created_at", { ascending: false })
      .limit(perTable),

    supabase
      .from("draft_replies")
      .select("id,created_at,status,to_email,subject,thread_id")
      .eq("restaurant_id", restaurant_id)
      .order("created_at", { ascending: false })
      .limit(perTable),

    supabase
      .from("outbox_actions")
      .select("id,created_at,status,provider,action_type,thread_id,payload")
      .eq("restaurant_id", restaurant_id)
      .order("created_at", { ascending: false })
      .limit(perTable),
  ]);

  // Error handling
  const errors = [inbox.error, bookings.error, drafts.error, actions.error].filter(Boolean);
  if (errors.length) {
    const msg = (errors[0] as any)?.message ?? String(errors[0]);
    return res.status(500).json({ ok: false, error: msg });
  }

  // Normalize into timeline items
  const items: any[] = [];

  for (const row of inbox.data ?? []) {
    items.push({
      ts: row.created_at,
      kind: "inbox_event",
      label: `Email classified: ${row.classified_type}`,
      meta: {
        provider: row.provider,
        from: row.from_email,
        subject: row.subject,
        confidence: row.classified_confidence,
        thread_id: row.thread_id,
        id: row.id,
      },
    });
  }

  for (const row of bookings.data ?? []) {
    items.push({
      ts: row.created_at,
      kind: "booking",
      label: `Booking ${row.status} (${row.people ?? "?"}p) ${row.booking_date_iso ?? ""} ${row.time ?? ""}`,
      meta: {
        source: row.source,
        thread_id: row.thread_id,
        id: row.id,
      },
    });
  }

for (const row of drafts.data ?? []) {
  items.push({
    ts: row.created_at,
    kind: "draft_reply",
    label: `Draft reply: ${row.status}`,
    meta: {
      to: row.to_email,
      subject: row.subject,
      thread_id: row.thread_id,
      id: row.id,
      status: row.status,
    },
  });
}

  for (const row of actions.data ?? []) {
    items.push({
      ts: row.created_at,
      kind: "outbox_action",
      label: `Action ${row.provider}:${row.action_type} (${row.status})`,
      meta: {
        thread_id: row.thread_id,
        status: row.status,
        payload: row.payload,
        id: row.id,
      },
    });
  }

  // Sort desc + cut to limit
  items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  return res.json({
    ok: true,
    restaurant_id,
    limit,
    data: items.slice(0, limit),
  });
});

app.get("/dashboard/view", (req, res) => {
  const restaurant_id = String(req.query.restaurant_id ?? "");
  if (!restaurant_id) {
    res.status(400).send("restaurant_id required");
    return;
  }

  const html = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>HospitalityOS Dashboard</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;padding:24px;background:#f6f7fb;color:#111}
    h1{margin:0 0 6px 0;font-size:28px}
    .sub{color:#666;margin:0 0 20px 0;font-size:13px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(180px,1fr));gap:12px;max-width:1000px}
    .card,.item{background:#fff;border:1px solid #e8e8ef;border-radius:16px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,0.04)}
    .k{font-size:12px;color:#666}
    .v{font-size:30px;margin-top:8px;font-weight:700}
    .section{margin-top:24px;max-width:1000px}
    .timeline{display:flex;flex-direction:column;gap:10px}
    .item-top{display:flex;justify-content:space-between;gap:12px;align-items:center}
    .label{font-weight:600}
    .ts{font-size:12px;color:#666;white-space:nowrap}
    .meta{margin-top:8px;font-size:13px;color:#444;line-height:1.5}
    .row{display:flex;gap:10px;margin-top:18px;align-items:center}
    button{border:1px solid #ddd;background:#fff;border-radius:10px;padding:10px 12px;cursor:pointer}
    pre{white-space:pre-wrap;word-break:break-word}
  </style>
</head>
<body>
  <h1>HospitalityOS</h1>
  <p class="sub" id="meta">Loading dashboard...</p>

  <div class="grid" id="cards"></div>

  <div class="row">
    <button onclick="loadAll()">Refresh</button>
    <span>Restaurant: ${restaurant_id}</span>
  </div>

  <div class="section">
    <h3>Recent Activity</h3>
    <div class="timeline" id="timeline"></div>
  </div>

<script>
const rid = ${JSON.stringify(restaurant_id)};

async function approveDraft(id) {
  const res = await fetch('/drafts/' + id + '/approve', { method: 'POST' });
  const json = await res.json();

  if (!json.ok) {
    alert('Error: ' + (json.error || 'unknown'));
    return;
  }

  alert('Reply sent');
  loadAll();
}

function renderMetrics(j) {
  const meta = document.getElementById('meta');
  const cards = document.getElementById('cards');

  if (!j.ok) {
    meta.textContent = 'Error loading metrics: ' + (j.error || 'unknown');
    cards.innerHTML = '';
    return;
  }

  meta.textContent = 'Operational demo view';
  const m = j.metrics || {};
  const items = [
    ['Emails processed', m.emails_processed ?? 0],
    ['Bookings created', m.bookings_created ?? 0],
    ['Function leads', m.function_leads ?? 0],
    ['Estimated revenue', '$' + (m.estimated_revenue ?? 0)],
    ['Drafts pending', m.drafts_pending ?? 0],
    ['Actions pending', m.actions_pending ?? 0]
  ];

  cards.innerHTML = items.map(function(item) {
    return '<div class="card"><div class="k">' + item[0] + '</div><div class="v">' + item[1] + '</div></div>';
  }).join('');
}

function renderTimeline(j) {
  const timeline = document.getElementById('timeline');

  if (!j.ok) {
    timeline.innerHTML = '<div class="item">Error loading timeline: ' + (j.error || 'unknown') + '</div>';
    return;
  }

  const rows = j.data || [];
  if (!rows.length) {
    timeline.innerHTML = '<div class="item">No activity yet</div>';
    return;
  }

  timeline.innerHTML = rows.map(function(row) {
    const meta = row.meta ? JSON.stringify(row.meta, null, 2) : '{}';
    let buttonHtml = '';

    if (row.kind === 'draft_reply' && row.meta && row.meta.id && row.meta.status === 'draft') {
      buttonHtml = '<button data-draft-id="' + row.meta.id + '" class="send-reply-btn">Send reply</button>';
    }

    return '' +
      '<div class="item">' +
        '<div class="item-top">' +
          '<div class="label">' + row.label + '</div>' +
          '<div class="ts">' + row.ts + '</div>' +
        '</div>' +
        '<div class="meta"><strong>Type:</strong> ' + row.kind + '</div>' +
        '<div class="meta">' + buttonHtml + '</div>' +
        '<div class="meta"><pre>' + meta + '</pre></div>' +
      '</div>';
  }).join('');

  document.querySelectorAll('.send-reply-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const id = btn.getAttribute('data-draft-id');
      if (id) approveDraft(id);
    });
  });
}

async function loadAll() {
  try {
    const metricsRes = await fetch('/dashboard?restaurant_id=' + encodeURIComponent(rid));
    const timelineRes = await fetch('/dashboard/timeline?restaurant_id=' + encodeURIComponent(rid) + '&limit=10');

    const metricsJson = await metricsRes.json();
    const timelineJson = await timelineRes.json();

    renderMetrics(metricsJson);
    renderTimeline(timelineJson);
  } catch (e) {
    document.getElementById('meta').textContent = 'Load failed: ' + String(e);
  }
}

loadAll();
</script>
</body>
</html>
`;

  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

const CreateRestaurantSchema = z.object({
  name: z.string().min(2),
  timezone: z.string().optional(),
});

app.get("/inbox-events", async (req, res) => {
  const restaurant_id = String(req.query?.restaurant_id ?? "");
  if (!restaurant_id) return res.status(400).json({ ok: false, error: "restaurant_id required" });

  const limit = Math.min(Number(req.query?.limit ?? 20), 100);

  const { data, error } = await supabase
    .from("inbox_events")
    .select("id,restaurant_id,created_at,classified_type,classified_confidence,from_email,subject,thread_id,provider,received_at")    .eq("restaurant_id", restaurant_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, data: data ?? [] });
});

app.post("/restaurants", async (req, res) => {
  const parsed = CreateRestaurantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const { name, timezone } = parsed.data;

  const { data, error } = await supabase
    .from("restaurants")
    .insert([{ name, timezone: timezone ?? "Australia/Perth" }])
    .select("id,name,timezone,created_at")
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.status(201).json({ ok: true, restaurant: data });
});

const CreateBookingSchema = z.object({
  restaurant_id: z.string().uuid(),
  customer_email: z.string().email(),
  customer_name: z.string().optional(),
  booking_date_iso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().optional(),
  people: z.number().int().positive().optional(),
  dietary: z.string().optional(),
  occasion: z.string().optional(),
  thread_id: z.string().optional(),
});

app.post("/bookings", async (req, res) => {
  const parsed = CreateBookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: parsed.error.flatten() });

  const b = parsed.data;

  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .upsert(
      [{ restaurant_id: b.restaurant_id, email: b.customer_email, name: b.customer_name ?? null }],
      { onConflict: "restaurant_id,email" }
    )
    .select("id,email,name")
    .single();

  if (custErr) return res.status(500).json({ ok: false, error: custErr.message });

  const missing: string[] = [];
  if (!b.booking_date_iso) missing.push("date");
  if (!b.time) missing.push("time");
  if (!b.people) missing.push("people");

  const status = missing.length > 0 ? "needs_info" : "pending";

  const { data: booking, error: bookErr } = await supabase
    .from("bookings")
    .insert([
      {
        restaurant_id: b.restaurant_id,
        customer_id: customer.id,
        booking_date_iso: b.booking_date_iso ?? null,
        time: b.time ?? null,
        people: b.people ?? null,
        dietary: b.dietary ?? null,
        occasion: b.occasion ?? null,
        thread_id: b.thread_id ?? null,
        status,
        confidence: 0,
        history: [{ ts: new Date().toISOString(), event: "created_manual", missing }],
      },
    ])
    .select("*")
    .single();

  if (bookErr) return res.status(500).json({ ok: false, error: bookErr.message });
  return res.status(201).json({ ok: true, booking });
});

app.post("/ai/extract-booking", async (req, res) => {
  const message_text = String(req.body?.message_text ?? "");
  if (!message_text || message_text.length < 3) {
    return res.status(400).json({ ok: false, error: "message_text required" });
  }

  const now_perth_iso = new Date().toISOString(); // ok per test

  try {
    const extracted = await extractBookingFromText({ now_perth_iso, message_text });
    return res.json({ ok: true, extracted });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// =============================
// DEMO ROUTES
// =============================

// get draft replies
app.get("/drafts", async (req, res) => {
  const restaurant_id = req.query.restaurant_id as string;

  const { data, error } = await supabase
    .from("draft_replies")
    .select("*")
    .eq("restaurant_id", restaurant_id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return res.status(500).json({ ok: false, error: error.message });

  res.json({ ok: true, data });
});


// get outbox actions
app.get("/actions", async (req, res) => {
  const restaurant_id = req.query.restaurant_id as string;

  const { data, error } = await supabase
    .from("outbox_actions")
    .select("*")
    .eq("restaurant_id", restaurant_id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return res.status(500).json({ ok: false, error: error.message });

  res.json({ ok: true, data });
});

// approve draft reply
app.post("/drafts/:id/approve", async (req, res) => {
  const id = req.params.id;

  // 1) load draft
  const { data: draft, error: readErr } = await supabase
    .from("draft_replies")
    .select("*")
    .eq("id", id)
    .single();

  if (readErr) return res.status(500).json({ ok: false, error: readErr.message });

  // 2) send email
  try {
await sendMailViaGraph({
  to: draft.to_email,
  subject: draft.subject ?? "(no subject)",
  text: draft.body,
});

 // 3) mark as sent
const { data: updated, error: updErr } = await supabase
  .from("draft_replies")
  .update({ status: "sent", updated_at: new Date().toISOString() })
  .eq("id", id)
  .select("*")
  .single();

if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

    return res.json({ ok: true, sent: true, draft: updated });
  } catch (e: any) {
    await supabase
      .from("draft_replies")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", id);

    return res.status(500).json({ ok: false, error: e?.message ?? String(e) });
  }
});

// approve action
app.post("/actions/:id/approve", async (req, res) => {

  const id = req.params.id;

  const { data, error } = await supabase
    .from("outbox_actions")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) return res.status(500).json({ ok: false, error: error.message });

  res.json({ ok: true, action: data });

});

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 HospitalityOS running on port ${PORT}`);
});



