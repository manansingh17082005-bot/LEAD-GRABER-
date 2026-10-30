
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const cfg = window.LEADPILOT_CONFIG || {};
  const STORAGE_KEY = "lead_graber_leads_v1";

  let supabase = null;
  let user = null;
  let currentLeads = [];
  let queue = [];
  let queueIndex = 0;
  let toastTimer;
  let rendering = false;

  const configured = Boolean(
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  );

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);

  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol)
        ? url.href
        : "#";
    } catch {
      return "#";
    }
  }

  function getLocalLeads() {
    try {
      const rows = JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "[]"
      );
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function saveLocalLeads(rows) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  }

  function toast(message) {
    let el = $("toast");

    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 3500);
  }

  function setSearchStatus(message, type = "") {
    const el = $("search-status");
    if (!el) return;

    el.textContent = message;
    el.className = "status-line " + type;
  }

  function setAuthStatus(message, type = "") {
    const el = $("auth-status");
    if (!el) return;

    el.textContent = message;
    el.className = "status-line " + type;
  }

  function connected() {
    return Boolean(supabase && user);
  }

  function updateConnection() {
    const dot = $("connection-dot");
    const title = $("connection-title");
    const subtitle = $("connection-subtitle");

    if (dot) dot.classList.toggle("online", connected());

    if (title) {
      title.textContent = connected()
        ? "Cloud sync connected"
        : configured
          ? "Sign in to sync"
          : "Local mode";
    }

    if (subtitle) {
      subtitle.textContent = connected()
        ? user.email || "Supabase connected"
        : configured
          ? "Sign in to search and sync leads"
          : "Check config.js";
    }

    if ($("user-label")) {
      $("user-label").textContent =
        user?.email || "Not signed in";
    }

    if ($("auth-button")) {
      $("auth-button").textContent =
        user ? "Sign out" : "Sign in / Create account";
    }
  }

  function fromDb(row) {
    return {
      ...row,
      id: row.id,
      name: row.name || "Unnamed business",
      url: row.url || "",
      snippet: row.snippet || "",
      source: row.source || "web",
      location: row.location || "",
      market: row.market || "",
      skill: row.skill || "",
      status: row.status || "New",
      phone: row.phone || "",
      email: row.email || ""
    };
  }

  async function allLeads() {
    if (connected()) {
      try {
        const { data, error } = await supabase
          .from("leads")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000);

        if (!error && Array.isArray(data)) {
          return data.map(fromDb);
        }

        console.error("Supabase leads query failed:", error);
      } catch (error) {
        console.error("Could not load cloud leads:", error);
      }
    }

    return getLocalLeads();
  }

  async function saveLead(lead) {
    const rows = getLocalLeads();
    const url = lead.url || "";

    const existingIndex = rows.findIndex(row =>
      (url && row.url === url) ||
      (lead.id && String(row.id) === String(lead.id))
    );

    const old = existingIndex >= 0
      ? rows[existingIndex]
      : {};

    const item = {
      ...old,
      ...lead,
      id: old.id || lead.id || (
        crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now()) + Math.random()
      ),
      phone: String(lead.phone || old.phone || "").trim(),
      status: lead.status || old.status || "New"
    };

    if (existingIndex >= 0) {
      rows[existingIndex] = item;
    } else {
      rows.unshift(item);
    }

    saveLocalLeads(rows);

    if (connected()) {
      const payload = {
        user_id: user.id,
        name: item.name || "Unnamed business",
        url: item.url,
        snippet: item.snippet || "",
        source: item.source || "web",
        location: item.location || "",
        skill: item.skill || "",
        status: item.status || "New",
        phone: item.phone || null,
        email: item.email || null,
        external_id: item.external_id || null
      };

      const { error } = await supabase
        .from("leads")
        .upsert(payload, { onConflict: "user_id,url" });

      if (error) {
        console.error("Supabase save failed:", error);
      }
    }

    return item;
  }

  async function updateLead(id, status) {
    const rows = getLocalLeads().map(row =>
      String(row.id) === String(id)
        ? { ...row, status }
        : row
    );

    saveLocalLeads(rows);

    if (connected()) {
      const { error } = await supabase
        .from("leads")
        .update({ status })
        .eq("id", id);

      if (error) console.error("Status update failed:", error);
    }

    await renderAll();
  }

  function getSkill() {
    const select = $("skill");
    if (!select) return "";

    return select.value === "custom skill"
      ? ($("custom-skill")?.value || "").trim()
      : select.value;
  }

  function buildQueries(skill, location, businessType) {
    const type = businessType ? businessType + " " : "";
    const place = location && location !== "Worldwide"
      ? ` "${location}"`
      : "";

    return [
      `${type}business ${skill} services official website contact${place}`,
      `${type}small business ${skill} contact phone website${place}`,
      `${type}business needing ${skill} services${place}`
    ];
  }

  async function runSearch(market, skill, businessType, source, freshness, count) {
    const { data, error } = await supabase.functions.invoke(
      "search-leads",
      {
        body: {
          skill,
          location: market.location,
          businessType,
          source,
          freshness,
          count,
          queries: buildQueries(
            skill,
            market.location,
            businessType
          )
        }
      }
    );

    if (error) throw new Error(error.message || "Search failed");

    return Array.isArray(data?.results) ? data.results : [];
  }

  async function searchLeads() {
    const button = $("search-button");
    if (!button) return;

    const skill = getSkill();
    const location = $("location")?.value || "Worldwide";
    const businessType = $("business-type")?.value?.trim() || "";
    const source = $("source")?.value || "web";
    const freshness = $("freshness")?.value || "any";
    const count = Number($("count")?.value || 20);

    if (!skill) {
      setSearchStatus("Choose a service first.", "error");
      return;
    }

    if (!connected()) {
      setSearchStatus(
        "Please sign in to Supabase before searching for live leads.",
        "error"
      );
      return;
    }

    button.disabled = true;
    button.textContent = "Searching…";

    const markets = location === "Worldwide"
      ? count === 10
        ? [{ location: "India", market: "India", count: 10 }]
        : [
            { location: "India", market: "India", count: 20 },
            {
              location: "International businesses outside India",
              market: "International",
              count: 20
            }
          ]
      : [{
          location,
          market: location.toLowerCase().includes("india")
            ? "India"
            : "International",
          count
        }];

    const results = [];
    const seen = new Set();
    const failures = [];

    try {
      for (const market of markets) {
        setSearchStatus(`Searching ${market.market}…`);

        try {
          const found = await runSearch(
            market, skill, businessType, source, freshness, market.count
          );

          for (const row of found) {
            const url = safeUrl(row.url);
            if (url === "#") continue;

            const key = url.replace(/\/+$/, "").toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
              ...row,
              id: row.id || key,
              url,
              name: row.name || "Unnamed business",
              snippet: row.snippet || "",
              phone: String(row.phone || "").trim(),
              email: row.email || "",
              source: row.source || source,
              location: row.location || market.location,
              market: market.market,
              skill,
              status: "New"
            });
          }
        } catch (error) {
          console.error(market.market + " search failed:", error);
          failures.push(market.market);
        }
      }

      if (!results.length) {
        setSearchStatus(
          failures.length
            ? `Search failed for ${failures.join(", ")}. Check the search-leads Edge Function logs.`
            : "No results returned. Try a different service or location.",
          "error"
        );
        currentLeads = [];
        await renderResults();
        return;
      }

      const existing = await allLeads();
      const existingByUrl = new Map(
        existing.filter(row => row.url).map(row => [row.url, row])
      );

      for (const lead of results) {
        const old = existingByUrl.get(lead.url);
        await saveLead({
          ...old,
          ...lead,
          phone: lead.phone || old?.phone || "",
          email: lead.email || old?.email || "",
          status: old?.status || "New"
        });
      }

      currentLeads = results;
      await renderResults();

      const indiaCount = results.filter(row => row.market === "India").length;
      const internationalCount = results.filter(
        row => row.market === "International"
      ).length;

      setSearchStatus(
        `Found ${results.length} results (${indiaCount} India, ${internationalCount} international).`,
        "success"
      );
    } catch (error) {
      console.error(error);
      setSearchStatus(error.message || "Search failed.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "⌕ Find relevant leads";
      await renderAll();
    }
  }

  function leadRow(lead) {
    const id = esc(lead.id);
    const title = esc(lead.name || "Unnamed business");
    const url = safeUrl(lead.url);
    const phone = esc(lead.phone || "No phone available");
    const location = esc(lead.market || lead.location || "—");
    const snippet = esc(lead.snippet || "No business summary available.");
    const status = lead.status || "New";
    const statuses = ["New", "Review", "Contacted", "Not a fit"];

    return `<tr>
      <td>
        <a class="lead-title" href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
        <div class="lead-meta">${phone}</div>
      </td>
      <td>
        <div class="match-note">${snippet}</div>
        <div class="lead-meta">${esc(lead.email || "")}</div>
      </td>
      <td>${location}<div class="lead-meta">${esc(lead.source || "web")}</div></td>
      <td>
        <select class="status-select" data-status-id="${id}" aria-label="Lead status">
          ${statuses.map(s => `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </td>
      <td>
        <button class="small-action" data-review-id="${id}" type="button">Review lead</button>
      </td>
    </tr>`;
  }

  async function renderResults() {
    const el = $("lead-rows");
    if (!el) return;

    el.innerHTML = currentLeads.length
      ? currentLeads.map(leadRow).join("")
      : '<tr><td colspan="5" class="empty-state">No search results yet.</td></tr>';
  }

  function ensureReviewPanel() {
    let panel = $("lead-review-panel");
    if (panel) return panel;

    panel = document.createElement("section");
    panel.id = "lead-review-panel";
    panel.className = "panel campaign-panel";
    panel.style.cssText =
      "display:none;width:100%;max-width:100%;min-width:0;overflow:hidden;";

    panel.innerHTML = `
      <div class="section-heading">
        <div>
          <div class="eyebrow">LEAD REVIEW</div>
          <h3 id="review-lead-name">Review selected business</h3>
          <p>Check the details and personalize your message before contacting the business.</p>
        </div>
        <button type="button" class="button button-quiet" id="review-close">Close</button>
      </div>
      <div id="review-lead-details" style="overflow-wrap:anywhere;line-height:1.8;margin-bottom:18px;"></div>
      <label class="field">
        <span>WhatsApp message — review and edit before opening WhatsApp</span>
        <textarea id="review-message" rows="8" style="width:100%;max-width:100%;min-width:0;resize:vertical;overflow-wrap:anywhere;"></textarea>
      </label>
      <div class="button-row">
        <button type="button" class="button button-quiet" id="review-generate">Generate draft</button>
        <button type="button" class="button button-quiet" id="review-copy">Copy message</button>
        <button type="button" class="button button-whatsapp" id="review-open-whatsapp">Open WhatsApp</button>
      </div>
      <p class="fine-print">WhatsApp will open with a draft. You must review and press Send yourself.</p>
    `;

    const anchor = $("campaigns-view") || $("dashboard-view") || document.querySelector("main") || document.body;
    anchor.appendChild(panel);

    $("review-close").addEventListener("click", () => {
      panel.style.display = "none";
    });

    $("review-generate").addEventListener("click", () => {
      const lead = getSelectedReviewLead();
      if (lead) $("review-message").value = buildMessage(lead);
    });

    $("review-copy").addEventListener("click", async () => {
      const message = $("review-message").value.trim();
      if (!message) return toast("Generate a message first.");

      try {
        await navigator.clipboard.writeText(message);
        toast("Message copied.");
      } catch {
        $("review-message").select();
        document.execCommand("copy");
        toast("Message copied.");
      }
    });

    $("review-open-whatsapp").addEventListener("click", () => {
      const lead = getSelectedReviewLead();
      if (!lead) return toast("Select a lead to review first.");

      const digits = String(lead.phone || "").replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) {
        return toast("No usable phone number found. Open the business website and verify its contact details.");
      }

      const message = $("review-message").value.trim();
      if (!message) return toast("Write or generate a message first.");

      window.open(
        `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
        "_blank",
        "noopener,noreferrer"
      );
    });

    return panel;
  }

  let selectedReviewLead = null;

  function getSelectedReviewLead() {
    return selectedReviewLead;
  }

  function buildMessage(lead) {
    const sender = $("sender-name")?.value?.trim() || "our team";
    const offer = $("offer")?.value?.trim() || lead.skill || "our services";
    const name = String(lead.name || "there").split(/[|—,-]/)[0].trim();

    return `Hi ${name}, I came across your business while researching ${lead.location || "businesses"} and wanted to reach out. I'm ${sender}, and I help businesses with ${offer}. I have a couple of ideas that may be useful for your business. Would you be open to a brief conversation? If this isn't relevant, no worries.`;
  }

  async function reviewLead(lead) {
    if (!lead) {
      toast("Could not find that lead. Refresh Saved Leads and try again.");
      return;
    }

    selectedReviewLead = lead;
    const panel = ensureReviewPanel();

    $("review-lead-name").textContent = lead.name || "Selected business";

    const website = safeUrl(lead.url);
    const websiteHtml = website === "#"
      ? "Not available"
      : `<a href="${website}" target="_blank" rel="noopener noreferrer">${esc(lead.url)}</a>`;

    $("review-lead-details").innerHTML = `
      <p><strong>Business:</strong> ${esc(lead.name || "Unknown")}</p>
      <p><strong>Location:</strong> ${esc(lead.location || lead.market || "Not provided")}</p>
      <p><strong>Phone:</strong> ${esc(lead.phone || "Not found — verify before outreach")}</p>
      <p><strong>Email:</strong> ${esc(lead.email || "Not provided")}</p>
      <p><strong>Website:</strong> ${websiteHtml}</p>
      <p><strong>Source summary:</strong> ${esc(lead.snippet || "No summary available")}</p>
    `;

    $("review-message").value = buildMessage(lead);
    panel.style.display = "block";
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function renderAll() {
    if (rendering) return;
    rendering = true;

    try {
      const rows = await allLeads();

      if ($("saved-count")) $("saved-count").textContent = rows.length;
      if ($("stat-total")) $("stat-total").textContent = rows.length;

      if ($("stat-review")) {
        $("stat-review").textContent = rows.filter(
          row => !["Contacted", "Not a fit"].includes(row.status)
        ).length;
      }

      if ($("stat-contacted")) {
        $("stat-contacted").textContent = rows.filter(
          row => row.status === "Contacted"
        ).length;
      }

      if ($("saved-rows")) {
        $("saved-rows").innerHTML = rows.length
          ? rows.map(leadRow).join("")
          : '<tr><td colspan="5" class="empty-state">No saved leads yet.</td></tr>';
      }

      const select = $("campaign-lead");

      const select = $("campaign-lead");

      if (select) {
        const previousValue = select.value;
        const options = [
          new Option("Choose a lead…", "")
        ];

        rows
          .filter(row => String(row.url || "").trim())
          .forEach(row => {
            const label = [
              row.name,
              row.business_name,
              row.company,
              row.title,
              row.url
            ]
              .map(value => String(value ?? "").trim())
              .find(value => value.length > 0) || "Unnamed lead";

            options.push(
              new Option(label, String(row.url).trim())
            );
          });

        select.replaceChildren(...options);
        select.style.color = "#f8fafc";
        select.style.backgroundColor = "#0b1425";

        if (options.some(option => option.value === previousValue)) {
          select.value = previousValue;
        }
      }

      updateConnection();
    } finally {
      rendering = false;
    }
  }

  function switchView(view) {
    const views = ["dashboard", "saved", "campaigns"];

    for (const name of views) {
      const el = $(name + "-view");
      if (el) el.hidden = name !== view;
    }

    document.querySelectorAll("[data-view]").forEach(button => {
      button.classList.toggle("active", button.dataset.view === view);
    });

    if ($("page-title")) {
      $("page-title").textContent =
        view === "dashboard" ? "Find your next client" :
        view === "saved" ? "Saved leads" : "WhatsApp outreach";
    }

    if (view === "campaigns") {
      const panel = $("lead-review-panel");
      if (panel && panel.style.display !== "none") {
        panel.scrollIntoView({ block: "nearest" });
      }
    }
  }

  async function selectedDropdownLead() {
    const url = $("campaign-lead")?.value;
    if (!url) return null;
    return (await allLeads()).find(row => row.url === url) || null;
  }

  async function prepareDropdownMessage() {
    const lead = await selectedDropdownLead();
    if (!lead) return toast("Choose a saved lead first.");

    const message = buildMessage(lead);
    const output = $("message-output");
    if (output) output.value = message;

    await reviewLead(lead);
  }

  async function openDropdownWhatsApp() {
    const lead = await selectedDropdownLead();
    if (!lead) return toast("Choose a saved lead first.");

    await reviewLead(lead);
  }

  async function startQueue() {
    const rows = await allLeads();

    queue = rows.filter(row => {
      const digits = String(row.phone || "").replace(/\D/g, "");
      return row.url && digits.length >= 8 && digits.length <= 15;
    });

    queueIndex = 0;

    if (!queue.length) {
      if ($("queue-status")) {
        $("queue-status").textContent =
          "No saved leads have usable phone numbers. Review the website/contact details first.";
      }
      return;
    }

    switchView("campaigns");
    await openQueueLead();
  }

  async function openQueueLead() {
    if (queueIndex >= queue.length) {
      if ($("queue-status")) $("queue-status").textContent = "Queue complete.";
      if ($("queue-next")) $("queue-next").disabled = true;
      return;
    }

    const lead = queue[queueIndex];
    if ($("campaign-lead")) $("campaign-lead").value = lead.url;

    if ($("queue-status")) {
      $("queue-status").textContent =
        `Contact ${queueIndex + 1} of ${queue.length}: ${lead.name}. Review the details and message before opening WhatsApp.`;
    }

    if ($("queue-next")) $("queue-next").disabled = false;
    await reviewLead(lead);
  }

  async function nextQueueLead() {
    if (!queue.length) {
      if ($("queue-status")) $("queue-status").textContent = "Start the queue first.";
      return;
    }

    queueIndex++;
    await openQueueLead();
  }

  function stopQueue() {
    queue = [];
    queueIndex = 0;
    if ($("queue-next")) $("queue-next").disabled = true;
    if ($("queue-status")) $("queue-status").textContent = "Queue stopped.";
  }

  function exportCsv() {
    allLeads().then(rows => {
      if (!rows.length) return toast("No leads to export.");

      const fields = [
        "name", "url", "snippet", "source", "location",
        "market", "skill", "phone", "email", "status"
      ];

      const csv = [
        fields.join(","),
        ...rows.map(row => fields.map(key =>
          `"${String(row[key] ?? "").replace(/"/g, '""')}"`
        ).join(","))
      ].join("\r\n");

      const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;"
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "lead-graber-leads.csv";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  document.addEventListener("click", async event => {
    const nav = event.target.closest("[data-view]");
    if (nav) switchView(nav.dataset.view);

    const reviewButton = event.target.closest("[data-review-id]");
    if (reviewButton) {
      const id = reviewButton.dataset.reviewId;
      const rows = await allLeads();
      const lead = [...currentLeads, ...rows].find(
        row => String(row.id) === String(id)
      );
      await reviewLead(lead);
    }

    const statusSelect = event.target.closest("[data-status-id]");
    if (statusSelect) {
      await updateLead(statusSelect.dataset.statusId, statusSelect.value);
    }
  });

  $("skill")?.addEventListener("change", () => {
    const wrap = $("custom-skill-wrap");
    if (wrap) wrap.hidden = $("skill").value !== "custom skill";
  });

  $("search-button")?.addEventListener("click", searchLeads);

  $("generate-message")?.addEventListener(
    "click", prepareDropdownMessage
  );

  $("copy-message")?.addEventListener("click", async () => {
    const text = $("message-output")?.value || "";
    if (!text) return toast("Generate a message first.");

    try {
      await navigator.clipboard.writeText(text);
      toast("Message copied.");
    } catch {
      $("message-output")?.select();
      document.execCommand("copy");
      toast("Message copied.");
    }
  });

  $("whatsapp-message")?.addEventListener(
    "click", openDropdownWhatsApp
  );

  $("campaign-lead")?.addEventListener("change", async () => {
    const lead = await selectedDropdownLead();
    if (lead) await reviewLead(lead);
  });

  $("queue-start")?.addEventListener("click", startQueue);
  $("queue-next")?.addEventListener("click", nextQueueLead);
  $("queue-stop")?.addEventListener("click", stopQueue);

  $("export-button")?.addEventListener("click", exportCsv);
  $("saved-export-button")?.addEventListener("click", exportCsv);

  $("auth-button")?.addEventListener("click", async () => {
    if (user) {
      const { error } = await supabase.auth.signOut();
      if (error) return toast(error.message);
      user = null;
      updateConnection();
      await renderAll();
    } else {
      $("auth-dialog")?.showModal();
    }
  });

  $("sign-in-button")?.addEventListener("click", async () => {
    if (!supabase) {
      setAuthStatus("Supabase is not configured. Check config.js.", "error");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: $("auth-email")?.value?.trim() || "",
      password: $("auth-password")?.value || ""
    });

    setAuthStatus(error ? error.message : "Signed in.", error ? "error" : "success");

    if (!error) {
      $("auth-dialog")?.close();
      await renderAll();
    }
  });

  $("sign-up-button")?.addEventListener("click", async () => {
    if (!supabase) {
      setAuthStatus("Supabase is not configured. Check config.js.", "error");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: $("auth-email")?.value?.trim() || "",
      password: $("auth-password")?.value || ""
    });

    setAuthStatus(
      error ? error.message : "Account request submitted. Check email if confirmation is enabled.",
      error ? "error" : "success"
    );
  });

  async function init() {
    updateConnection();

    if (!configured) {
      setSearchStatus("Supabase configuration missing. Check config.js.", "error");
      await renderAll();
      return;
    }

    try {
      const { createClient } = await import(
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
      );

      supabase = createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY
      );

      const { data, error } = await supabase.auth.getSession();
      if (error) console.error("Supabase session error:", error);

      user = data?.session?.user || null;
      updateConnection();
      await renderAll();

      supabase.auth.onAuthStateChange((_event, session) => {
        user = session?.user || null;
        updateConnection();
        renderAll();
      });
    } catch (error) {
      console.error("Supabase initialization failed:", error);
      setSearchStatus("Could not initialize Supabase. Check browser console and config.js.", "error");
      updateConnection();
    }
  }

  init();
})();
