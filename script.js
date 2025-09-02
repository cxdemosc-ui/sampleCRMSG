/*******************************************************
 * SampleCRM Frontend Script (2025-08, Final)
 * - Preserves your original endpoints, API usage, UI, and functions
 * - Shows Savings transactions (null => "Savings")
 * - Section order: Savings → Debit → Credit → Service Requests
 * - Consistent column widths via .crm-table
 * - Action buttons now refresh reliably (with short polling)
 *******************************************************/

/* ==============================
   CONSTANTS & GLOBAL STATE
   ============================== */

const SUPABASE_PROJECT_REF = 'yrirrlfmjjfzcvmkuzpl';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlyaXJybGZtampmemN2bWt1enBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMxODk1MzQsImV4cCI6MjA2ODc2NTUzNH0.Iyn8te51bM2e3Pvdjrx3BkG14WcBKuqFhoIq2PSwJ8A';
const AUTH_TOKEN = API_KEY;

const RPC_BASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co/rest/v1/rpc/`;
const ENDPOINTS = {
  getCustomer: `${RPC_BASE_URL}get_customer_unified_search`,
  webexAction: 'https://hooks.us.webexconnect.io/events/RHV57QR4M3'
};

let latestCustomer = null;

// Preserve last search details so refresh can re-fetch the exact same customer
let lastSearchVal = '';
let lastSearchType = '';

/* ==============================
   UTILITIES
   ============================== */

// Show bootstrap-compatible alert in #messageBar
function showMessage(msg, type='info') {
  const bar = document.getElementById('messageBar');
  if (!bar) return;
  bar.className = `alert alert-${type}`;
  bar.innerText = msg;
  bar.style.display = 'block';
}

function maskCard(c) { return (!c || c.length < 4) ? '' : '**** **** **** ' + c.slice(-4); }
function formatMoney(a) { const n = Number(a); return isNaN(n) ? '0.00' : n.toLocaleString(undefined, { minimumFractionDigits:2 }); }

// Date formatting to DD-MM-YY HH:mm
function formatDateDMYHM(dt) {
  if (!dt) return '';
  let safe = String(dt).trim().replace(' ', 'T');   // tolerate "YYYY-MM-DD HH:mm:ss"
  safe = safe.split('.')[0];                        // drop fractional seconds if present
  const d = new Date(safe);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getFullYear()).slice(-2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function cardStatusBadge(status) {
  const lc = String(status || '').toLowerCase();
  if (lc === 'active') return `<span class="badge badge-status active">Active</span>`;
  if (lc === 'blocked') return `<span class="badge badge-status blocked">Blocked</span>`;
  if (lc.includes('re-issue') || lc.includes('reissued') || lc.includes('reissue')) return `<span class="badge badge-status reissued">Re-Issued</span>`;
  if (lc === 'lost') return `<span class="badge badge-status lost">Lost</span>`;
  return `<span class="badge badge-status">${status || ''}</span>`;
}

// Sleep helper for async/await flow
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

/* ==============================
   API CALLS
   ============================== */

// Unified customer search (mobile, account, email)
async function fetchCustomer(identifier, searchType='auto') {
  const body = { p_mobile_no: null, p_account_number: null, p_email: null };

  // Keep your original decision logic:
  if (searchType === 'email') {
    body.p_email = identifier;
  } else if (/^\d{8}$/.test(identifier)) {
    // If exactly 8 digits, treat as account number
    body.p_account_number = identifier;
  } else {
    // Otherwise treat as mobile number
    body.p_mobile_no = identifier;
  }

  const r = await fetch(ENDPOINTS.getCustomer, {
    method: 'POST',
    headers: {
      apikey: API_KEY,
      Authorization: `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!r.ok) throw new Error(`API Error: ${r.status}`);
  return r.json();
}

// Webex Connect action (Block/Unblock/Reissue/Lost/Dispute & SR actions)
async function sendAction(payload) {
  const r = await fetch(ENDPOINTS.webexAction, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  // Some hooks return 202/empty body. Swallow JSON errors and return null.
  try { return await r.json(); } catch { return null; }
}

/* ==============================
   REFRESH HELPERS
   ============================== */

// Re-fetch customer using last search details
async function refreshCustomerData() {
  if (!lastSearchVal) return;
  try {
    const data = await fetchCustomer(lastSearchVal, lastSearchType);
    await showCustomer(data);
  } catch (e) {
    showMessage('Error refreshing data.', 'danger');
  }
}

// After actions, your backend may update asynchronously.
// This polls a few times so UI catches the update without manual re-search.
async function pollRefreshAfterAction({
  initialDelay = 800,   // wait a moment for backend to start processing
  tries = 6,            // total refresh attempts
  interval = 1500       // wait between attempts
} = {}) {
  await sleep(initialDelay);
  for (let i = 0; i < tries; i++) {
    await refreshCustomerData();
    // Optional: Break early if you can detect a change. We keep it simple & safe.
    await sleep(interval);
  }
}

/* ==============================
   RENDERING
   ============================== */

async function showCustomer(data) {
  latestCustomer = data;
  const div = document.getElementById('customer-details');

  if (!data || data.error) {
    if (div) div.style.display = 'none';
    return showMessage(data?.error || 'No customer found.', 'danger');
  }

  if (div) div.style.display = 'block';
  const msg = document.getElementById('messageBar');
  if (msg) msg.style.display = 'none';

  let html = `<div class="card p-3 mb-3 bg-light border-primary">
    <div class="row">
      <div class="col-md-6">
        <h5 class="text-primary">${data.customer_first_name || data.first_name} ${data.customer_last_name || data.last_name}</h5>
        <div><strong>Mobile:</strong> ${data.mobile_no}</div>
        <div><strong>Alt Mobile:</strong> ${data.mobile_no2 || ''}</div>
        <div><strong>Email:</strong> ${data.email || ''}</div>
      </div>
      <div class="col-md-6">
        <div><strong>Address:</strong> ${data.customer_address || data.address || 'N/A'}</div>
        <div><strong>City:</strong> ${data.customer_city || data.city || 'N/A'}</div>
        <div><strong>Account Number:</strong> ${data.account_number || 'N/A'}</div>
        <div><strong>Account Balance:</strong> $${formatMoney(data.account_balance)}</div>
      </div>
    </div>
  </div>`;

  // Savings Account section FIRST (transaction_medium null => treat as "Savings")
  const savingsTxs = (data.recent_transactions || []).filter(
    tx => !tx.transaction_medium || String(tx.transaction_medium).toLowerCase() === 'savings'
  );
  html += `<h6 class="text-primary">Savings Account Transactions</h6>`;
  html += savingsTxs.length
    ? `<table class="table table-sm table-bordered crm-table"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th></tr></thead>
       <tbody>${savingsTxs.map(tx => `
         <tr>
           <td>${formatDateDMYHM(tx.transaction_date)}</td>
           <td>${tx.transaction_type || ''}</td>
           <td>${formatMoney(tx.amount)}</td>
           <td>${tx.reference_note || ''}</td>
         </tr>`).join('')}</tbody></table>`
    : `<p>No savings account transactions found.</p>`;

  // Debit Card section
  html += `<h6 class="text-primary">Debit Card</h6>`;
  html += (data.debit_cards || []).map(c => `
    <div class="border rounded p-2 mb-2 bg-white card-section">
      ${maskCard(c.card_number)} ${cardStatusBadge(c.status)}
      ${(c.transactions && c.transactions.length)
        ? `<table class="table table-sm table-bordered crm-table"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th></tr></thead>
           <tbody>${c.transactions.map(tx => `
             <tr>
               <td>${formatDateDMYHM(tx.transaction_date)}</td>
               <td>${tx.transaction_type || ''}</td>
               <td>${formatMoney(tx.amount)}</td>
               <td>${tx.reference_note || ''}</td>
             </tr>`).join('')}</tbody></table>`
        : '<p>No debit card transactions found.</p>'}
      <div class="card-actions">${renderCardActions(c, "Debit")}</div>
    </div>`).join('');

  // Credit Card section
  html += `<h6 class="text-primary">Credit Card</h6>`;
  html += (data.credit_cards || []).map(c => `
    <div class="border rounded p-2 mb-2 bg-white card-section">
      ${maskCard(c.card_number)} ${cardStatusBadge(c.status)}
      ${(c.transactions && c.transactions.length)
        ? `<table class="table table-sm table-bordered crm-table"><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th></tr></thead>
           <tbody>${c.transactions.map(tx => `
             <tr>
               <td>${formatDateDMYHM(tx.transaction_date)}</td>
               <td>${tx.transaction_type || ''}</td>
               <td>${formatMoney(tx.amount)}</td>
               <td>${tx.reference_note || ''}</td>
             </tr>`).join('')}</tbody></table>`
        : '<p>No credit card transactions found.</p>'}
      <div class="card-actions">${renderCardActions(c, "Credit")}</div>
    </div>`).join('');

  // Service Requests
  html += `<h6 class="text-primary">Service Requests</h6>`;
  html += (data.service_requests || []).length
    ? `<table class="table table-sm table-bordered crm-table">
         <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Raised</th><th>Resolution</th><th>Description</th><th>Actions</th></tr></thead>
         <tbody>${data.service_requests.map(sr => `
           <tr>
             <td>${sr.request_id}</td>
             <td>${sr.request_type || ''}</td>
             <td>${sr.status || ''}</td>
             <td>${formatDateDMYHM(sr.raised_date)}</td>
             <td>${sr.resolution_date ? formatDateDMYHM(sr.resolution_date) : '-'}</td>
             <td class="sr-desc" title="${sr.description || ''}">${sr.description || ''}</td>
             <td>${sr.status === 'Open'
                  ? `<button class="btn btn-sm btn-update-sr" data-srid="${sr.request_id}">Update</button>
                     <button class="btn btn-sm btn-close-sr" data-srid="${sr.request_id}">Close</button>`
                  : ''}</td>
           </tr>`).join('')}
         </tbody>
       </table>
       <div class="mt-2 text-right"><button id="newSRBtn" class="btn btn-primary">Create New Service Request</button></div>`
    : `<p>No service requests found.</p>
       <div class="mt-2 text-right"><button id="newSRBtn" class="btn btn-primary">Create New Service Request</button></div>`;

  div.innerHTML = html;

  // Bind/ensure handlers are active for the freshly rendered content
  bindActionHandlers(data);
}

/* ==============================
   ACTION BUTTONS & FORM BINDINGS
   ============================== */

function renderCardActions(card, type) {
  const status = (card.status || '').toLowerCase();
  let actions = status !== 'blocked'
    ? `<button class="btn btn-sm btn-block-card" data-type="${type}" data-no="${card.card_number}">Block</button> `
    : `<button class="btn btn-sm btn-unblock-card" data-type="${type}" data-no="${card.card_number}">UnBlock</button> `;
  const dis = (/re\-?issued?/i.test(status) || /lost/i.test(status)) ? 'disabled' : '';
  actions += `<button class="btn btn-sm btn-reissue-card" data-type="${type}" data-no="${card.card_number}" ${dis}>Reissue</button>
              <button class="btn btn-sm btn-mark-lost" data-type="${type}" data-no="${card.card_number}" ${dis}>Lost</button>
              <button class="btn btn-sm btn-dispute" data-type="${type}" data-no="${card.card_number}" ${dis}>Dispute</button>`;
  return actions;
}

/**
 * Attach handlers for:
 *  - Card actions (Block/Unblock/Reissue/Lost/Dispute)
 *  - New SR form
 *  - Update/Close SR form
 * Notes:
 *  - We use jQuery delegated handlers for dynamic content.
 *  - For SR button to open modal, we keep the existing #newSRBtn binding too.
 */
function bindActionHandlers(data) {
  // Card action buttons (delegated so re-rendering won't break them)
  $(document).off('click.crmActions', '.btn-block-card, .btn-unblock-card, .btn-reissue-card, .btn-mark-lost, .btn-dispute')
    .on('click.crmActions', '.btn-block-card, .btn-unblock-card, .btn-reissue-card, .btn-mark-lost, .btn-dispute', async function() {
      const btn = this;
      const cardNo = btn.dataset.no;
      const typeLabel = btn.dataset.type;

      let actionType =
        btn.classList.contains('btn-block-card')   ? 'Block'   :
        btn.classList.contains('btn-unblock-card') ? 'UnBlock' :
        btn.classList.contains('btn-reissue-card') ? 'Reissue' :
        btn.classList.contains('btn-mark-lost')    ? 'Lost'    : 'Dispute';

      if (['Block','UnBlock','Reissue','Lost'].includes(actionType)) {
        const ok = confirm(`${actionType} this ${typeLabel} card?\nCard Number: ${String(cardNo).slice(-4)}`);
        if (!ok) return;
      }

      const payload = {
        custPhone:  data.mobile_no,
        custPhone2: data.mobile_no2,
        custAccount:data.account_number || '',
        custCard:   cardNo,
        cardType:   typeLabel,
        custEmail:  data.email,
        custAction: actionType,
        serviceRequestType: "",
        serviceDescription: ""
      };

      showMessage(`${actionType} request in progress...`, 'info');
      await sendAction(payload);

      // Poll a few times to catch backend async updates
      await pollRefreshAfterAction();
    });

  // New SR form (create)
  $("#newSRForm").off("submit.crmNewSR").on("submit.crmNewSR", async e => {
    e.preventDefault();
    const srType = $("#srType").val().trim();
    const srDesc = $("#srDesc").val().trim();
    if (!srType || !srDesc) {
      $("#newSRAlert").show().addClass('alert-danger').text("Type and Description required.");
      return;
    }

    const payload = {
      custPhone:  data.mobile_no,
      custPhone2: data.mobile_no2,
      custAccount:data.account_number || '',
      custCard:   "",
      cardType:   "",
      custEmail:  data.email,
      custAction: "NewRequest",
      serviceRequestType: srType,
      serviceDescription: srDesc
    };

    $("#newSRAlert").removeClass().addClass('alert alert-info').show().text("Creating Service Request...");
    await sendAction(payload);
    $("#newSRModal").modal('hide');

    await pollRefreshAfterAction();
  });

  // Prepare Update/Close SR modal (delegated)
  $(document).off("click.crmOpenEdit", ".btn-update-sr, .btn-close-sr")
    .on("click.crmOpenEdit", ".btn-update-sr, .btn-close-sr", function() {
      const isUpdate = $(this).hasClass("btn-update-sr");
      const row = $(this).closest("tr");
      $("#editSRModalLabel").text(isUpdate ? "Update Service Request" : "Close Service Request");
      $("#editSRAction").val(isUpdate ? "Update" : "Close");
      $("#editSRType").val(row.find("td:nth-child(2)").text());
      $("#editSRDesc").val(row.find(".sr-desc").attr("title") || "");
      $("#editSRAlert").hide().removeClass();
      $("#editSRModal").modal("show");
    });

  // Submit Update/Close SR
  $("#editSRForm").off("submit.crmEditSR").on("submit.crmEditSR", async e => {
    e.preventDefault();
    const action = $("#editSRAction").val();
    const srType = $("#editSRType").val();
    const srDesc = $("#editSRDesc").val().trim();
    if (!srDesc) {
      $("#editSRAlert").show().addClass('alert-danger').text("Description is required.");
      return;
    }

    const payload = {
      custPhone:  data.mobile_no,
      custPhone2: data.mobile_no2,
      custAccount:data.account_number || '',
      custCard:   "",
      cardType:   "",
      custEmail:  data.email,
      custAction: action,                 // "Update" or "Close"
      serviceRequestType: srType,
      serviceDescription: srDesc
    };

    $("#editSRAlert").removeClass().addClass('alert alert-info').show().text(`${action} in progress...`);
    await sendAction(payload);
    $("#editSRModal").modal('hide');

    await pollRefreshAfterAction();
  });
}

/* ==============================
   BOOTSTRAP / PAGE INIT
   ============================== */

// Try to make URL search working + normal search flow preserved
document.addEventListener('DOMContentLoaded', () => {
  // 1) Show current date/time in header (safe guard if el missing)
  const currentDateEl = document.getElementById('currentDate');
  if (currentDateEl) {
    currentDateEl.textContent = new Date().toLocaleString('en-GB', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // 2) Get DOM elements
  const searchBtn   = document.getElementById('searchBtn');
  const searchField = document.getElementById('searchMobile');  // keep your original ID
  const detailsDiv  = document.getElementById('customer-details');

  // Guard early if search elements missing
  if (!searchBtn || !searchField) {
    console.warn('Search controls not found on page.');
    return;
  }

  // 3) Enter key triggers search
  searchField.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchBtn.click();
    }
  });

  // 4) Main search click handler (preserves lastSearchVal/Type)
  searchBtn.onclick = async () => {
    const val = (searchField.value || '').trim();
    if (!val) {
      showMessage('Please enter a mobile, account, or email.', 'warning');
      if (detailsDiv) detailsDiv.style.display = 'none';
      return;
    }

    showMessage('Loading customer info...', 'info');
    if (detailsDiv) detailsDiv.style.display = 'none';

    // Detect type: email if contains '@'; account if exactly 8 digits; else mobile
    let type = val.includes('@')
      ? 'email'
      : (/^\d{8}$/.test(val) ? 'account' : 'mobile');

    // Preserve for refresh after actions
    lastSearchVal = val;
    lastSearchType = type;

    try {
      const data = await fetchCustomer(val, type);
      await showCustomer(data);
    } catch (e) {
      if (detailsDiv) detailsDiv.style.display = 'none';
      showMessage('Error fetching data.', 'danger');
    }
  };

  // 5) Auto-load from URL param (case-sensitive: ?mobileNo=...)
  const params = new URLSearchParams(window.location.search);
  const paramVal = params.get('mobileNo');
  if (paramVal) {
    searchField.value = paramVal.trim();
    // Trigger search now that handler is bound AND ensure lastSearch* are set
    searchBtn.click();
  }

  // 6) Bind "Create New Service Request" button (kept from your original)
  $(document).off('click.crmNewSRBtn', '#newSRBtn').on('click.crmNewSRBtn', '#newSRBtn', () => {
    if (!latestCustomer) {
      showMessage('Load a customer first.', 'danger');
      return;
    }
    $("#newSRModal").modal("show");
  });
});

/*  ======= End of File =======  */
