const restaurantId = localStorage.getItem("mia_restaurant_id");
let currentPage = "dashboard";
window.manualBookingOverrides = window.manualBookingOverrides || {};

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

  const manualOverride = window.manualBookingOverrides?.[draft.id] || {};

  return {
    ...draft,
    booking: {
      ...(draft.booking || {}),
      ...manualOverride,
    },
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

const threshold = window.functionGuestThreshold || 10;

const upcomingRelevantDrafts = draftsWithContext.filter((draft) => {
  const booking = draft.booking || {};
  const sourceText = `${draft.original_email?.snippet || ""} ${draft.body || ""}`.toLowerCase();

  const isFunction =
    (booking.people && booking.people >= threshold) ||
    sourceText.includes("set menu") ||
    sourceText.includes("function") ||
    sourceText.includes("birthday");

  const hasNotes = !!(booking.notes && booking.notes.trim());

  return isFunction || hasNotes;
});

  const requestsContainer = document.getElementById("requests");
  const upcomingContainer = document.getElementById("upcoming");
  const actionsContainer = document.getElementById("actions");
  const requestsTitle = document.getElementById("requests-title");
if (requestsTitle) {
  requestsTitle.innerText = `New Requests (${draftsWithContext.length})`;
}

const count = draftsWithContext.length;

requestsTitle.innerText =
  count === 0
    ? "New Requests"
    : `New Requests (${count})`;

  const pageTitle = document.getElementById("page-title");

if (pageTitle) {
  pageTitle.innerText = currentPage === "inbox" ? "Inbox" : "Dashboard";
}

  const visibleDrafts =
  currentPage === "inbox"
    ? draftsWithContext
    : draftsWithContext.slice(0, 1);

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

  if (!upcomingRelevantDrafts.length) {
  upcomingContainer.innerHTML = "<p>No upcoming reminders.</p>";
} else {
  upcomingContainer.innerHTML = upcomingRelevantDrafts
    .slice(0, 5)
    .map(renderUpcomingItem)
    .join("");
}

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

  const availableMenus = window.functionMenus || [];
const selectedMenu = availableMenus[0] || null;

const estimatedFood = selectedMenu ? guestCount * Number(selectedMenu.price || 0) : 0;
const estimatedDrinks = guestCount * 20;
const estimatedRevenue = estimatedFood + estimatedDrinks;

  const threshold = window.functionGuestThreshold || 10;
window.functionMenus = window.functionMenus || [
  {
    id: "menu_a",
    name: "Set Menu A",
    price: 55,
    description: "Shared starters + pizza + dessert"
  },
  {
    id: "menu_b",
    name: "Set Menu B",
    price: 75,
    description: "Premium selection + mains + dessert"
  }
];

const isFunction =
  (guestCount && guestCount >= threshold) ||
  lower.includes("set menu") ||
  lower.includes("function") ||
  lower.includes("birthday");

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
        ${
          availableMenus.length
            ? availableMenus.map(menu => `
              <div>• ${menu.name} — $${Number(menu.price || 0)}pp</div>
            `).join("")
            : `<div>No set menus configured yet.</div>`
        }
        <div class="revenue">
          Estimated Revenue: $${estimatedRevenue.toLocaleString()}
        </div>
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

  document.querySelectorAll(".sidebar nav a").forEach((link) => {
    link.classList.remove("active");
  });

  if (el) {
    el.classList.add("active");
  }

  const dashboardPage = document.getElementById("dashboard-page");
  const functionsPage = document.getElementById("functions-page");

  if (page === "functions") {
    renderFunctionsPage();
    return;
  }

  if (functionsPage) functionsPage.style.display = "none";
  if (dashboardPage) dashboardPage.style.display = "block";

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

  const nameEl = document.getElementById(`edit-name-${draftId}`);
  const guestsEl = document.getElementById(`edit-guests-${draftId}`);
  const dateEl = document.getElementById(`edit-date-${draftId}`);
  const timeEl = document.getElementById(`edit-time-${draftId}`);
  const notesEl = document.getElementById(`edit-notes-${draftId}`);

  const existingOverride = window.manualBookingOverrides[draftId] || {};

  window.manualBookingOverrides[draftId] = {
    ...existingOverride,
    customer_name: nameEl ? nameEl.value.trim() || null : null,
    people: guestsEl && guestsEl.value.trim() ? Number(guestsEl.value.trim()) : null,
    booking_date_iso: dateEl ? dateEl.value.trim() || null : null,
    time: timeEl ? timeEl.value.trim() || null : null,
    notes: notesEl ? notesEl.value.trim() || null : null,
  };

  loadRequests();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateFunctionThreshold() {
  const input = document.getElementById("function-threshold-input");
  if (!input) return;

  const value = Number(input.value);
  if (!value || value < 1) return;

  window.functionGuestThreshold = value;

  if (currentPage === "functions") {
    renderFunctionsPage();
    return;
  }

  loadRequests();
}

function renderFunctionsPage() {
  const dashboardPage = document.getElementById("dashboard-page");
  const functionsPage = document.getElementById("functions-page");
  if (!functionsPage) return;

  if (dashboardPage) dashboardPage.style.display = "none";
  functionsPage.style.display = "block";

  const threshold = window.functionGuestThreshold || 10;

  if (!window.functionMenusDraft) {
    window.functionMenusDraft = JSON.parse(JSON.stringify(window.functionMenus || []));
  }

  functionsPage.innerHTML = `
  <div class="page-header">
    <h1>Functions</h1>
    <div class="subtitle">Manage function rules and set menu logic</div>
  </div>

  <div class="panel">
    <h2>Function Settings</h2>

    <div class="edit-row" style="max-width: 260px; margin-top: 16px;">
      <label>Function threshold</label>
      <input
        type="number"
        id="function-threshold-input"
        value="${threshold}"
        min="1"
        onchange="updateFunctionThreshold()"
      />
    </div>

    <p style="margin-top: 12px; color: #6b7280;">
      Requests with guests equal to or above this number will be treated as function enquiries.
    </p>
  </div>

  <div class="panel">
    <h2>Set Menus</h2>

    ${
      (window.functionMenusDraft || []).length
        ? window.functionMenusDraft.map(menu => `
          <div class="menu-edit-card">
            <div class="edit-row">
              <label>Name</label>
              <input type="text" value="${escapeHtml(menu.name || "")}" onchange="updateMenuDraft('${menu.id}', 'name', this.value)" />
            </div>

            <div class="edit-row">
              <label>Price per person ($)</label>
              <input type="number" value="${Number(menu.price || 0)}" onchange="updateMenuDraft('${menu.id}', 'price', this.value)" />
            </div>

            <div class="edit-row">
              <label>Description</label>
              <textarea onchange="updateMenuDraft('${menu.id}', 'description', this.value)">${escapeHtml(menu.description || "")}</textarea>
            </div>

            <div class="edit-actions">
              <button class="edit-btn" onclick="removeMenuDraft('${menu.id}')">Remove</button>
            </div>
          </div>
        `).join("")
        : `<p style="color:#6b7280;">No set menus configured yet.</p>`
    }

    <div class="edit-actions" style="margin-top: 16px;">
      <button class="approve-btn" onclick="addNewMenuDraft()">+ Add Menu</button>
      <button class="approve-btn" onclick="saveFunctionMenus()">Save Menus</button>
      <button class="edit-btn" onclick="cancelFunctionMenus()">Cancel</button>
    </div>
  </div>

  <div class="panel">
    <h2>Menu Upload</h2>
    <p style="color:#6b7280; margin-bottom:12px;">
      Add PDF or image files of your menu for Mia to learn from.
    </p>

    <div class="menu-upload-placeholder">
      <button class="approve-btn" onclick="alert('Upload coming next')">Add PDF or Image</button>
    </div>
  </div>
`;
}

function updateMenu(menuId, field, value) {
  const menu = window.functionMenus.find(m => m.id === menuId);
  if (!menu) return;

  if (field === "price") {
    menu[field] = Number(value);
  } else {
    menu[field] = value;
  }
}

function addNewMenu() {
  const newMenu = {
    id: "menu_" + Date.now(),
    name: "New Menu",
    price: 60,
    description: ""
  };

  window.functionMenus.push(newMenu);
  renderFunctionsPage();
}

function updateMenuDraft(menuId, field, value) {
  const menu = (window.functionMenusDraft || []).find(m => m.id === menuId);
  if (!menu) return;

  if (field === "price") {
    menu[field] = Number(value);
  } else {
    menu[field] = value;
  }
}

function addNewMenuDraft() {
  if (!window.functionMenusDraft) {
    window.functionMenusDraft = [];
  }

  window.functionMenusDraft.push({
    id: "menu_" + Date.now(),
    name: "New Menu",
    price: 60,
    description: ""
  });

  renderFunctionsPage();
}

function removeMenuDraft(menuId) {
  window.functionMenusDraft = (window.functionMenusDraft || []).filter(m => m.id !== menuId);
  renderFunctionsPage();
}

function saveFunctionMenus() {
  window.functionMenus = JSON.parse(JSON.stringify(window.functionMenusDraft || []));
  renderFunctionsPage();
  loadRequests();
}

function cancelFunctionMenus() {
  window.functionMenusDraft = JSON.parse(JSON.stringify(window.functionMenus || []));
  renderFunctionsPage();
}

function renderUpcomingItem(draft) {
  const booking = draft.booking || {};
  const guests = booking.people || "—";
  const date = booking.booking_date_iso || "—";
  const time = booking.time || "—";
  const notes = booking.notes || "";

  const sourceText = `${draft.original_email?.snippet || ""} ${draft.body || ""}`.toLowerCase();
  const threshold = window.functionGuestThreshold || 10;

  const isFunction =
    (booking.people && booking.people >= threshold) ||
    sourceText.includes("set menu") ||
    sourceText.includes("function") ||
    sourceText.includes("birthday");

  const title = isFunction ? "Function Booking" : "Booking Reminder";
  const reason = notes || (isFunction ? "Needs function follow-up" : "Needs attention");

  return `
    <div class="upcoming-card">
      <div class="upcoming-card-header">
        <div class="upcoming-card-title">${title}</div>
        <div class="upcoming-card-time">${date} ${time}</div>
      </div>

      <div class="upcoming-card-meta">${guests} guests</div>
      <div class="upcoming-card-note">${reason}</div>

      ${
        isFunction
          ? `<div class="upcoming-card-actions">
               <button class="approve-btn" onclick="printRunsheet('${draft.id}')">Print Runsheet</button>
             </div>`
          : ""
      }
    </div>
  `;
}

function printRunsheet(draftId) {
  alert(`Runsheet printing coming next for draft ${draftId}`);
}

function logout() {
  localStorage.removeItem("mia_restaurant_id");
  localStorage.removeItem("mia_user_email");
  window.location.href = "/login.html";
} 