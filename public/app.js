const restaurantId = "88727ef0-d7a7-4ae7-9d01-d8f30e820528";

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

  if (!draftsWithContext.length) {
    requestsContainer.innerHTML = "<p>No new requests.</p>";
  } else {
    requestsContainer.innerHTML = draftsWithContext.slice(0, 5).map(renderDraftCard).join("");
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
}

function renderDraftCard(draft) {
  const body = draft.body || "";
  const lower = body.toLowerCase();

  const originalEmail = draft.original_email || null;
  const originalSubject = originalEmail?.subject || "No subject";
  const originalFrom = originalEmail?.from || "";
  const originalSnippet = originalEmail?.snippet || "";

  const isFunction =
    lower.includes("set menu") ||
    lower.includes("function") ||
    lower.includes("birthday") ||
    lower.includes("guests");

  const title = isFunction ? "Function Request" : "Booking Request";
  const customer = draft.to_email || "Unknown guest";
  const status = draft.status || "draft";

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

      ${
        status === "draft"
          ? `
          <div class="request-body">
            <textarea id="reply-${draft.id}" class="reply-editor">${body}</textarea>
          </div>
        `
          : `
          <div class="request-body">
            ${body.replace(/\n/g, "<br/>")}
          </div>
        `
      }

      ${
        isFunction
          ? `
          <div class="menu-box">
            <div class="menu-title">Suggested Menus</div>
            <div>• Set Menu A — $55pp</div>
            <div>• Set Menu B — $75pp</div>
            <div class="revenue">Estimated Revenue: $1,320</div>
          </div>
        `
          : ""
      }

      ${
        status === "draft"
          ? `
          <div class="request-actions">
            <button class="edit-btn" onclick="teachMiaDraft('${draft.id}')">Save & Teach Mia</button>
            <button class="approve-btn" onclick="approve('${draft.id}')">Approve & Send</button>
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

    const category = draft.body?.toLowerCase().includes("function") ||
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

    alert("Mia learned from your edit ✅");
  } catch (err) {
    console.error(err);
    alert("Teach Mia failed");
  }
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
  const card = document.querySelector(`[data-id="${id}"]`);
  if (!card) return;

  const bodyDiv = card.querySelector(".request-body");
  if (!bodyDiv) return;

  const currentText = bodyDiv.innerText;

  bodyDiv.innerHTML = `
    <textarea class="edit-textarea">${currentText}</textarea>
    <div class="request-actions" style="margin-top:10px;">
      <button class="approve-btn" onclick="saveDraft('${id}')">Save</button>
    </div>
  `;
}

async function saveDraft(id) {
  const card = document.querySelector(`[data-id="${id}"]`);
  if (!card) return;

  const textarea = card.querySelector(".edit-textarea");
  if (!textarea) return;

  const newBody = textarea.value;

  try {
    const res = await fetch(`/drafts/${id}/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body: newBody }),
    });

    const json = await res.json();

    if (!json.ok) {
      alert("Update failed: " + (json.error || "Unknown error"));
      return;
    }

    await loadRequests();
  } catch (err) {
    console.error("saveDraft error", err);
    alert("Error saving draft");
  }
}

