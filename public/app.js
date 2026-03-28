const restaurantId = localStorage.getItem("mia_restaurant_id");
let currentPage = "dashboard";

if (!restaurantId) {
  window.location.href = "/login.html";
  throw new Error("No restaurant session found");
}

let isLoading = false;



console.log("APP JS LOADED 🔥");

async function loadRequests() {
  const draftsRes = await fetch(`/drafts?restaurant_id=${restaurantId}`);
  const actionsRes = await fetch(`/actions?restaurant_id=${restaurantId}`);
  const timelineRes = await fetch(`/dashboard/timeline?restaurant_id=${restaurantId}&limit=50`);

  const draftsJson = await draftsRes.json();
  const actionsJson = await actionsRes.json();
  const timelineJson = await timelineRes.json();

  const drafts = draftsJson.data || [];
  const actions = actionsJson.data || [];
  const timelineItems = timelineJson.data || [];

  const inboxEvents = timelineItems.filter((item) => item.kind === "inbox_event");

  const draftsWithContext = drafts.map((draft) => {
    const matchedEmail = inboxEvents.find(
      (item) => item.meta?.thread_id && item.meta.thread_id === draft.thread_id
    );

    return {
      ...draft,
      original_email: matchedEmail
        ? {
            subject: matchedEmail.meta?.subject || "",
            from: matchedEmail.meta?.from || "",
            snippet: matchedEmail.meta?.snippet || "",
          }
        : null,
    };
  });

window.allDrafts = draftsWithContext;

  const requestsContainer = document.getElementById("requests");
  const upcomingContainer = document.getElementById("upcoming");
  const actionsContainer = document.getElementById("actions");
  const pageTitle = document.getElementById("page-title");

if (pageTitle) {
  pageTitle.innerText = currentPage === "inbox" ? "Inbox" : "Dashboard";
}

  const visibleDrafts =
  currentPage === "inbox"
    ? draftsWithContext
    : draftsWithContext.slice(0, 5);

if (!draftsWithContext.length) {
  requestsContainer.innerHTML = "<p>No new requests.</p>";
} else {
  requestsContainer.innerHTML = visibleDrafts.map(renderDraftCard).join("");
}

  if (!actions.length) {
    actionsContainer.innerHTML = "<p>No pending actions.</p>";
  } else {
    actionsContainer.innerHTML = actions.slice(0, 5).map(renderActionCard).join("");
  }

  upcomingContainer.innerHTML = `
    <div class="upcoming-item">Fri 19:00 — 2 guests</div>
    <div class="upcoming-item">Sat 24 guests — Birthday Function</div>
    <div class="upcoming-item">Sun 12:30 — 6 guests</div>
  `;
  updateMiaStatus({
  drafts: draftsWithContext,
  actions: actions
});
}

function renderDraftCard(draft) {
  const body = draft.body || "";
  const lower = body.toLowerCase();

  const originalEmail = draft.original_email || null;
  const originalSubject = originalEmail?.subject || "No subject";
  const originalFrom = originalEmail?.from || "";
  const originalSnippet = originalEmail?.snippet || "";
  const booking = draft.booking || {};
  const sourceText = `${draft.original_email?.snippet || ""} ${body}`;

const guestCount = booking.people ?? extractGuestCountFromText(sourceText) ?? "—";
const bookingDate = booking.booking_date_iso || extractDateFromText(sourceText) || "—";
const bookingTime = booking.time || extractTimeFromText(sourceText) || "—";
const customerName = booking.customer_name || "—";
    extractGuestCountFromText(body) ||
    0;

  const estimatedFood = guestCount * 55;
  const estimatedDrinks = guestCount * 20;
  const estimatedRevenue = estimatedFood + estimatedDrinks;

  const isFunction =
    lower.includes("set menu") ||
    lower.includes("function") ||
    lower.includes("birthday") ||
    lower.includes("guests");

  const title = isFunction ? "Function Request" : "Booking Request";
  const customer = draft.to_email || "Unknown guest";
  const status = draft.status || "draft";

const bookingNotes = booking.notes || "—";

const bookingDetailsHtml = `
  <div class="booking-extract">
    <div class="extract-title">${isFunction ? "Function Details" : "Booking Details"}</div>
    <div>Name: ${customerName}</div>
    <div>Guests: ${guestCount}</div>
    <div>Date: ${bookingDate}</div>
    <div>Time: ${bookingTime}</div>
    <div>Notes: ${bookingNotes}</div>

    <div class="guest-actions">
      <button class="edit-btn" onclick="enableBookingEdit('${draft.id}')">Edit</button>
    </div>

    <div id="booking-editor-${draft.id}"></div>
  </div>
`;

const copyButtonHtml = `<button class="edit-btn" onclick="copyBooking('${draft.id}')">${isFunction ? "Copy Function" : "Copy Booking"}</button>`;


  return `
    <div class="request-card" data-id="${draft.id}">
      <div class="request-header">
        <div>
          <div class="request-type">${title}</div>
          <div class="request-customer">${customer}</div>
        </div>
        <div class="badge ${status === "sent" ? "badge-sent" : "badge-draft"}">${status}</div>
      </div>

      ${
        originalEmail
          ? `
          <div class="original-email-box">
            <div class="original-email-title">Original Email</div>
            <div><strong>Subject:</strong> ${originalSubject}</div>
            <div><strong>From:</strong> ${originalFrom}</div>
            <div class="original-email-snippet">${originalSnippet.replace(/\n/g, "<br/>")}</div>
          </div>
        `
          : ""
      }

      <div class="request-body" id="body-${draft.id}">
  ${body.replace(/\n/g, "<br/>")}
</div>

${bookingDetailsHtml}

            ${
        isFunction
          ? `
          <div class="menu-box">
            <div class="menu-title">Suggested Menus</div>
            <div>• Set Menu A — $55pp</div>
            <div>• Set Menu B — $75pp</div>
            <div class="revenue">Estimated Revenue: $${estimatedRevenue.toLocaleString()}</div>
          </div>
        `
          : ""
      }

      ${
        status === "draft"
          ? `
          <div class="request-actions" id="actions-${draft.id}">
  <button class="edit-btn" onclick="editDraft('${draft.id}')">Edit</button>
  ${copyButtonHtml}
  <button class="approve-btn" onclick="approve('${draft.id}')">Send</button>
</div>
        `
          : ""
      }
    </div>
  `;
}

async function teachMiaDraft(draftId) {
  try {
    const textarea = document.getElementById(`reply-${draftId}`);
    if (!textarea) {
      alert("Reply editor not found");
      return;
    }

    const human_edited_reply = textarea.value;

    const draft = window.allDrafts?.find((d) => d.id === draftId);
    if (!draft) {
      alert("Draft not found");
      return;
    }

    const customer_message =
      draft.original_email?.snippet ||
      draft.customer_message ||
      "";

    const category =
      draft.body?.toLowerCase().includes("function") ||
      draft.body?.toLowerCase().includes("set menu") ||
      draft.body?.toLowerCase().includes("birthday")
        ? "function"
        : "booking";

    const res = await fetch("/learn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        restaurant_id: draft.restaurant_id,
        category,
        customer_message,
        ai_draft: draft.body || "",
        human_edited_reply,
      }),
    });

    const json = await res.json();

    if (!res.ok || !json.ok) {
      console.error(json);
      alert("Teach Mia failed");
      return;
    }

    // aggiorna il draft in memoria locale
    draft.body = human_edited_reply;

    // aggiorna visualizzazione
    const bodyDiv = document.getElementById(`body-${draftId}`);
    if (bodyDiv) {
      bodyDiv.innerHTML = human_edited_reply.replace(/\n/g, "<br/>");
    }

    const actionsDiv = document.getElementById(`actions-${draftId}`);
    if (actionsDiv) {
      actionsDiv.innerHTML = `
        <button class="edit-btn" onclick="editDraft('${draftId}')">Edit</button>
        <button class="approve-btn" onclick="approve('${draftId}')">Approve & Send</button>
      `;
    }

    alert("Mia learned from your edit ✅");
  } catch (err) {
    console.error(err);
    alert("Teach Mia failed");
  }
}

function extractGuestCountFromText(text) {
  if (!text) return "";

  const matches = text.match(/\b(\d+)\s*(people|guests|pax)\b/i);
  if (matches) return matches[1];

  const alt = text.match(/\bfor\s+(\d+)\b/i);
  if (alt) return alt[1];

  return "";
}

function extractDateFromText(text) {
  if (!text) return "";

  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  return "";
}

function extractTimeFromText(text) {
  if (!text) return "";

  const time = text.match(/\b(\d{1,2}:\d{2})\b/);
  if (time) return time[1];

  return "";
}

function copyBooking(id) {
  const draft = window.allDrafts?.find((d) => d.id === id);
  console.log("COPY DRAFT", draft);
  if (!draft) return;

  const booking = draft.booking || {};
  const body = draft.body || "";

  const isFunction =
    body.toLowerCase().includes("function") ||
    body.toLowerCase().includes("set menu") ||
    body.toLowerCase().includes("birthday") ||
    body.toLowerCase().includes("guests");

  const guestCount = booking.people ?? extractGuestCountFromText(body) ?? "";
  const bookingDate = booking.booking_date_iso || extractDateFromText(body) || "";
  const bookingTime = booking.time || extractTimeFromText(body) || "";
  const customerName = booking.customer_name || "";

  const text = isFunction
    ? `
Function Lead
Name: ${customerName}
Guests: ${guestCount}
Date: ${bookingDate}
Time: ${bookingTime}
Occasion: ${body.toLowerCase().includes("birthday") ? "Birthday" : ""}
`.trim()
    : `
Name: ${customerName}
Guests: ${guestCount}
Date: ${bookingDate}
Time: ${bookingTime}
`.trim();

  navigator.clipboard.writeText(text);
  alert(isFunction ? "Function details copied ✅" : "Booking copied ✅");
}

function renderActionCard(action) {
  const payload = action.payload || {};
  return `
    <div class="action-card">
      <div class="action-title">${action.action_type || "Action"}</div>
      <div>Status: ${action.status || "queued"}</div>
      <div>Provider: ${action.provider || "-"}</div>
      <div>Guests: ${payload.people ?? "-"}</div>
      <div>Date: ${payload.booking_date_iso ?? "-"}</div>
      <div>Time: ${payload.time ?? "-"}</div>
    </div>
  `;
}

async function approve(id) {
  try {
    console.log("approve click", id);

    const res = await fetch(`/drafts/${id}/approve`, { method: "POST" });
    const json = await res.json();

    console.log("approve response", json);

    if (!json.ok) {
      alert("Send failed: " + (json.error || "Unknown error"));
      return;
    }

    alert("Reply sent successfully");
    await loadRequests();
  } catch (err) {
    console.error("approve error", err);
    alert("Network/server error");
  }
}

loadRequests();

async function approveDraft(id) {
  console.log("approveDraft click", id);

  try {
    const res = await fetch(`/drafts/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const json = await res.json();
    console.log("approveDraft response", json);

    if (!json.ok) {
      alert("Approve draft failed: " + (json.error || "Unknown error"));
      return;
    }

    await loadRequests();
  } catch (err) {
    console.error("approveDraft error", err);
    alert("Network/server error on approve draft");
  }
}

async function approveAction(id) {
  console.log("approveAction click", id);

  try {
    const res = await fetch(`/actions/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const json = await res.json();
    console.log("approveAction response", json);

    if (!json.ok) {
      alert("Approve action failed: " + (json.error || "Unknown error"));
      return;
    }

    await loadRequests();
  } catch (err) {
    console.error("approveAction error", err);
    alert("Network/server error on approve action");
  }
}

function editDraft(id) {
  const draft = window.allDrafts?.find((d) => d.id === id);
  if (!draft) return;

  const bodyDiv = document.getElementById(`body-${id}`);
  if (!bodyDiv) return;


  bodyDiv.innerHTML = `
    <textarea id="reply-${id}" class="reply-editor">${draft.body || ""}</textarea>
  `;

  const actionsDiv = document.getElementById(`actions-${id}`);
  if (!actionsDiv) return;

  actionsDiv.innerHTML = `
    <button class="edit-btn" onclick="teachMiaDraft('${id}')">Save & Teach</button>
    <button class="approve-btn" onclick="approve('${id}')">Approve & Send</button>
  `;
}

function extractGuestCountFromText(text) {
  if (!text) return 0;

  const matches = text.match(/\b(\d+)\s*(people|guests|pax)\b/i);
  if (matches) return Number(matches[1]);

  const alt = text.match(/\bfor\s+(\d+)\b/i);
  if (alt) return Number(alt[1]);

  return 0;
}


function updateMiaStatus({ drafts = [], actions = [] } = {}) {
  const statusEl = document.getElementById("mia-text");
  const dotEl = document.querySelector(".mia-dot");
  if (!statusEl) return;

  const draftCount = drafts.filter((d) => (d.status || "draft") === "draft").length;
  const sentCount = drafts.filter((d) => d.status === "sent").length;
  const actionCount = actions.length;

  if (dotEl) {
    dotEl.classList.remove("is-live", "is-busy", "is-idle");
  }

  if (draftCount > 0) {
    statusEl.innerText = `${draftCount} draft repl${draftCount === 1 ? "y" : "ies"} ready`;
    if (dotEl) dotEl.classList.add("is-busy");
    return;
  }

  if (actionCount > 0) {
    statusEl.innerText = `${actionCount} pending action${actionCount === 1 ? "" : "s"}`;
    if (dotEl) dotEl.classList.add("is-busy");
    return;
  }

  if (sentCount > 0) {
    statusEl.innerText = `${sentCount} repl${sentCount === 1 ? "y" : "ies"} sent`;
    if (dotEl) dotEl.classList.add("is-live");
    return;
  }

  statusEl.innerText = "Mia is online";
  if (dotEl) dotEl.classList.add("is-idle");
}

function setPage(page, el) {
  currentPage = page;

  // rimuove active da tutti i link
  document.querySelectorAll(".sidebar nav a").forEach((link) => {
    link.classList.remove("active");
  });

  // aggiunge active al link cliccato
  if (el) {
    el.classList.add("active");
  }

  // ricarica i dati
  loadRequests();
}

function enableBookingEdit(draftId) {
  const draft = (window.allDrafts || []).find((d) => d.id === draftId);
  if (!draft) return;

  const booking = draft.booking || {};
  const sourceText = `${draft.original_email?.snippet || ""} ${draft.body || ""}`;

  const currentName = booking.customer_name || "";
  const currentGuests = booking.people ?? extractGuestCountFromText(sourceText) ?? "";
  const currentDate = booking.booking_date_iso || extractDateFromText(sourceText) || "";
  const currentTime = booking.time || extractTimeFromText(sourceText) || "";
  const currentNotes = booking.notes || "";

  const editorEl = document.getElementById(`booking-editor-${draftId}`);
  if (!editorEl) return;

  editorEl.innerHTML = `
    <div class="booking-edit-form">
      <div class="edit-row">
        <label>Name</label>
        <input id="edit-name-${draftId}" type="text" value="${escapeHtml(currentName)}" />
      </div>

      <div class="edit-row">
        <label>Guests</label>
        <input id="edit-guests-${draftId}" type="number" min="1" value="${currentGuests}" />
      </div>

      <div class="edit-row">
        <label>Date</label>
        <input id="edit-date-${draftId}" type="text" value="${escapeHtml(currentDate)}" placeholder="YYYY-MM-DD" />
      </div>

      <div class="edit-row">
        <label>Time</label>
        <input id="edit-time-${draftId}" type="text" value="${escapeHtml(currentTime)}" placeholder="HH:MM" />
      </div>

      <div class="edit-row">
        <label>Notes</label>
        <textarea id="edit-notes-${draftId}" rows="3" placeholder="Add notes...">${escapeHtml(currentNotes)}</textarea>
      </div>

      <div class="edit-actions">
        <button class="approve-btn" onclick="saveBookingEdit('${draftId}')">Save</button>
        <button class="edit-btn" onclick="loadRequests()">Cancel</button>
      </div>
    </div>
  `;
}

function saveBookingEdit(draftId) {
  const draft = (window.allDrafts || []).find((d) => d.id === draftId);
  if (!draft) return;

  if (!draft.booking) draft.booking = {};

  const nameEl = document.getElementById(`edit-name-${draftId}`);
  const guestsEl = document.getElementById(`edit-guests-${draftId}`);
  const dateEl = document.getElementById(`edit-date-${draftId}`);
  const timeEl = document.getElementById(`edit-time-${draftId}`);
  const notesEl = document.getElementById(`edit-notes-${draftId}`);

  draft.booking.customer_name = nameEl ? nameEl.value.trim() || null : null;
  draft.booking.people = guestsEl && guestsEl.value.trim() ? Number(guestsEl.value.trim()) : null;
  draft.booking.booking_date_iso = dateEl ? dateEl.value.trim() || null : null;
  draft.booking.time = timeEl ? timeEl.value.trim() || null : null;
  draft.booking.notes = notesEl ? notesEl.value.trim() || null : null;

  loadRequests();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function logout() {
  localStorage.removeItem("mia_restaurant_id");
  localStorage.removeItem("mia_user_email");
  window.location.href = "/login.html";
} 