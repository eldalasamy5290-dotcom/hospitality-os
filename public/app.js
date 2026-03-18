const restaurantId = "88727ef0-d7a7-4ae7-9d01-d8f30e820528";

async function loadRequests() {
  const draftsRes = await fetch(`/drafts?restaurant_id=${restaurantId}`);
  const actionsRes = await fetch(`/actions?restaurant_id=${restaurantId}`);

  const draftsJson = await draftsRes.json();
  const actionsJson = await actionsRes.json();

  const drafts = draftsJson.data || [];
  const actions = actionsJson.data || [];

  const requestsContainer = document.getElementById("requests");
  const upcomingContainer = document.getElementById("upcoming");
  const actionsContainer = document.getElementById("actions");

  if (!drafts.length) {
    requestsContainer.innerHTML = "<p>No new requests.</p>";
  } else {
    requestsContainer.innerHTML = drafts.slice(0, 5).map(renderDraftCard).join("");
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

  const isFunction =
    lower.includes("set menu") ||
    lower.includes("function") ||
    lower.includes("birthday") ||
    lower.includes("guests");

  const title = isFunction ? "Function Request" : "Booking Request";
  const customer = draft.to_email || "Unknown guest";
  const status = draft.status || "draft";

  return `
    <div class="request-card">
      <div class="request-header">
        <div>
          <div class="request-type">${title}</div>
          <div class="request-customer">${customer}</div>
        </div>
        <div class="badge ${status === "sent" ? "badge-sent" : "badge-draft"}">${status}</div>
      </div>

      <div class="request-body">
        ${body.replace(/\n/g, "<br/>")}
      </div>

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
            <button class="approve-btn" onclick="approve('${draft.id}')">Approve & Send</button>
          </div>
        `
          : ""
      }
    </div>
  `;
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
  const res = await fetch(`/drafts/${id}/approve`, { method: "POST" });
  const json = await res.json();

  if (!json.ok) {
    alert("Send failed: " + (json.error || "Unknown error"));
    return;
  }

  alert("Reply sent successfully");
  loadRequests();
}

loadRequests();
