
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const cfg = window.LEADPILOT_CONFIG || {};
  const configured = Boolean(
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
  );

  const STORAGE_KEY = "lead_graber_leads_v1";

  let supabase = null;
  let user = null;
  let currentLeads = [];
  let currentView = "dashboard";
  let queue = [];
  let queueIndex = 0;
  let toastTimer;

  const esc = value =>
    String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);

  const safeUrl = value => {
    try {
      const u = new URL(value);
      return ["http:", "https:"].includes(u.protocol)
        ? u.href
        : "#";
    } catch {
      return "#";
    }
  };

  const localLeads = () => {
    try {
      return JSON.parse(
        localStorage.getItem(STORAGE_KEY) || "[]"
      );
    } catch {
      return [];
    }
  };

  const writeLocal = rows =>
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));

  const isConnected = () => Boolean(supabase && user);

  function notify(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => el.classList.remove("show"),
      2800
    );
  }

  function setStatus(message, type = "") {
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

  function updateConnection(message = "") {
    if ($("connection-dot")) {
      $("connection-dot").classList.toggle(
        "online",
        isConnected()
      );
    }

    if ($("connection-title")) {
      $("connection-title").textContent = isConnected()
        ? "Cloud sync connected"
        : configured
          ? "Sign in to sync"
          : "Local mode";
    }

    if ($("connection-subtitle")) {
      $("connection-subtitle").textContent = isConnected()
        ? "Supabase account connected"
        : message || (
          configured
            ? "Sign in to search live leads"
            : "Check config.js"
        );
    }

    if ($("user-label")) {
      $("user-label").textContent =
        user?.email || "Not signed in";
    }

    if ($("auth-button")) {
      $("auth-button").textContent = user
        ? "Sign out"
        : "Sign in / Create account";
    }
  }

  async function initSupabase() {
    if (!configured) {
      updateConnection("Supabase URL/key missing");
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

      const { data } = await supabase.auth.getSession();
      user = data?.session?.user || null;

      supabase.auth.onAuthStateChange((_event, session) => {
        user = session?.user || null;
        updateConnection();
        renderAll();
      });

      updateConnection();
      await renderAll();
    } catch (error) {
      console.error(error);
      updateConnection("Could not load Supabase SDK");
    }
  }

  async function allLeads() {
    if (isConnected()) {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);

      if (!error && data) {
        return data.map(fromDb);
      }

      console.error("Loading cloud leads failed:", error);
    }

    return localLeads();
  }

  function fromDb(row) {
    return {
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
      email: row.email || "",
      created_at: row.created_at
    };
  }

  async function saveLead(lead) {
    const item = {
      ...lead,
      id: lead.id || (
        crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now()) + Math.random()
      ),
      status: lead.status || "New",
      phone: String(lead.phone || "").trim()
    };

    const rows = localLeads();

    const index = rows.findIndex(row =>
      (item.url && row.url === item.url) ||
      String(row.id) === String(item.id)
    );

    if (index >= 0) {
      rows[index] = {
        ...rows[index],
        ...item,
        phone: item.phone || rows[index].phone || ""
      };
    } else {
      rows.unshift(item);
    }

    writeLocal(rows);

    if (isConnected()) {
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
        .upsert(payload, {
          onConflict: "user_id,url"
        });

      if (error) {
        console.error("Cloud save error:", error);
      }
    }
  }

  async function updateLead(id, status) {
    const rows = localLeads().map(row =>
      String(row.id) === String(id)
        ? { ...row, status }
        : row
    );

    writeLocal(rows);

    if (isConnected()) {
      const { error } = await supabase
        .from("leads")
        .update({ status })
        .eq("id", id);

      if (error) {
        console.error("Status update failed:", error);
      }
    }

    await renderAll();
  }

  function getSkill() {
    return $("skill").value === "custom skill"
      ? $("custom-skill").value.trim()
      : $("skill").value;
  }

  function buildQueries(skill, location, businessType) {
    const type = businessType
      ? businessType + " "
      : "";

    const place =
      location && location !== "Worldwide"
        ? ` "${location}"`
        : "";

    return [
      `${type}business ${skill} services official website contact${place}`,
      `${type}business looking for ${skill} freelance services${place}`,
      `${type}small business ${skill} contact phone website${place}`
    ];
  }

  async function runMarketSearch(
    market,
    skill,
    businessType,
    source,
    freshness,
    count
  ) {
    const { data, error } =
      await supabase.functions.invoke("search-leads", {
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
      });

    if (error) {
      throw new Error(
        error.message || "Search function failed"
      );
    }

    return Array.isArray(data?.results)
      ? data.results
      : [];
  }

  async function searchLeads() {
    const skill = getSkill();
    const selectedMarket = $("location").value;
    const businessType = $("business-type").value.trim();
    const source = $("source").value;
    const freshness = $("freshness").value;
    const count = Number($("count").value);

    if (!skill) {
      setStatus(
        "Choose or enter a service first.",
        "error"
      );
      return;
    }

    if (!isConnected()) {
      setStatus(
        configured
          ? "Please sign in before searching live leads."
          : "Supabase is not configured. Check config.js.",
        "error"
      );
      return;
    }

    const button = $("search-button");
    button.disabled = true;
    button.textContent = "Searching…";
    currentLeads = [];

    const markets = selectedMarket === "Worldwide"
      ? (
          count === 10
            ? [{
                location: "India",
                market: "India",
                count: 10
              }]
            : [
                {
                  location: "India",
                  market: "India",
                  count: 20
                },
                {
                  location: "International businesses outside India",
                  market: "International",
                  count: 20
                }
              ]
        )
      : [{
          location: selectedMarket,
          market: selectedMarket.toLowerCase().includes("india")
            ? "India"
            : "International",
          count
        }];

    const results = [];
    const seen = new Set();
    const failures = [];

    try {
      for (const market of markets) {
        setStatus(`Searching ${market.market}…`);

        try {
          const rows = await runMarketSearch(
            market,
            skill,
            businessType,
            source,
            freshness,
            market.count
          );

          for (const row of rows) {
            if (!row.url) continue;

            const url = safeUrl(row.url);
            if (url === "#") continue;

            const key = url
              .replace(/\/+$/, "")
              .toLowerCase();

            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
              ...row,
              id: row.id || (
                crypto.randomUUID
                  ? crypto.randomUUID()
                  : key
              ),
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
          console.error(
            `${market.market} search failed:`,
            error
          );
          failures.push(market.market);
        }
      }

      if (!results.length) {
        setStatus(
          failures.length
            ? `Search failed for ${failures.join(" and ")}. Check the search-leads Edge Function logs and API secret.`
            : "No results returned. Try another service or business type.",
          "error"
        );

        await renderResults();
        return;
      }

      const existing = await allLeads();

      const byUrl = new Map(
        existing
          .filter(row => row.url)
          .map(row => [row.url, row])
      );

      let added = 0;

      for (const lead of results) {
        const previous = byUrl.get(lead.url);

        const merged = {
          ...previous,
          ...lead,
          phone: lead.phone || previous?.phone || "",
          email: lead.email || previous?.email || "",
          status: previous?.status || "New"
        };

        await saveLead(merged);

        if (!previous) added++;
      }

      currentLeads = results.map(lead => ({
        ...lead,
        phone: lead.phone || byUrl.get(lead.url)?.phone || "",
        status: byUrl.get(lead.url)?.status || "New"
      }));

      const india = currentLeads.filter(
        row => row.market === "India"
      ).length;

      const international = currentLeads.filter(
        row => row.market === "International"
      ).length;

      setStatus(
        `Returned ${currentLeads.length} results (${india} India, ${international} international); ${added} new leads saved. The count depends on search API results.`,
        "success"
      );

      await renderResults();
    } catch (error) {
      console.error(error);

      setStatus(
        `${error.message || "Search failed"}. Check Supabase configuration and Edge Function deployment.`,
        "error"
      );
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
    const phone = esc(lead.phone || "No phone found");
    const market = esc(
      lead.market || lead.location || "—"
    );
    const snippet = esc(
      lead.snippet || "No summary supplied by search source."
    );

    const statusOptions = [
      "New",
      "Review",
      "Contacted",
      "Not a fit"
    ];

    return `<tr>
      <td>
        <a class="lead-title" href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
        <div class="lead-meta">${phone}</div>
      </td>
      <td>
        <div class="match-note">${snippet}</div>
        <div class="lead-meta">${esc(lead.email || "")}</div>
      </td>
      <td>
        ${market}
        <div class="lead-meta">${esc(lead.source || "web")}</div>
      </td>
      <td>
        <select class="status-select" data-status-id="${id}">
          ${statusOptions.map(status =>
            `<option ${status === (lead.status || "New") ? "selected" : ""}>${status}</option>`
          ).join("")}
        </select>
      </td>
      <td>
        <button class="small-action" data-save-id="${id}">Outreach</button>
      </td>
    </tr>`;
  }

  async function renderResults() {
    $("lead-rows").innerHTML = currentLeads.length
      ? currentLeads.map(leadRow).join("")
      : '<tr><td colspan="5" class="empty-state">No results to display yet.</td></tr>';
  }

  async function renderAll() {
    const rows = await allLeads();

    $("saved-count").textContent = rows.length;
    $("stat-total").textContent = rows.length;

    $("stat-review").textContent = rows.filter(
      row => !["Contacted", "Not a fit"].includes(row.status)
    ).length;

    $("stat-contacted").textContent = rows.filter(
      row => row.status === "Contacted"
    ).length;

    $("saved-rows").innerHTML = rows.length
      ? rows.map(leadRow).join("")
      : '<tr><td colspan="5" class="empty-state">No saved leads yet.</td></tr>';

    const select = $("campaign-lead");
    const old = select.value;

    select.innerHTML =
      '<option value="">Choose a lead…</option>' +
      rows.map(row =>
        `<option value="${esc(row.url)}">${esc(row.name || row.url)}</option>`
      ).join("");

    if (rows.some(row => row.url === old)) {
      select.value = old;
    }

    updateConnection();
  }

  function switchView(view) {
    currentView = view;

    for (const name of [
      "dashboard",
      "saved",
      "campaigns"
    ]) {
      $(name + "-view").hidden = name !== view;
    }

    document.querySelectorAll(".nav-item").forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.view === view
      );
    });

    $("page-title").textContent =
      view === "dashboard"
        ? "Find your next client"
        : view === "saved"
          ? "Saved leads"
          : "WhatsApp outreach";
  }

  async function selectedLead() {
    const url = $("campaign-lead").value;
    return (await allLeads()).find(row => row.url === url);
  }

  async function prepareMessage() {
    const lead = await selectedLead();

    if (!lead) {
      notify("Choose a saved lead first.");
      return "";
    }

    const sender = $("sender-name").value.trim() || "Manan";
    const offer = $("offer").value.trim() ||
      lead.skill || "my services";

    const name = String(lead.name || "your team")
      .split(/[|—,-]/)[0]
      .trim();

    const message =
      `Hi ${name}, I came across your business while researching ${lead.location || "businesses"} and wanted to reach out. I'm ${sender}, and I help businesses with ${offer}. I had a couple of ideas that may be useful for your business. Would you be open to a brief conversation? If this isn't relevant, no worries.`;

    $("message-output").value = message;
    return message;
  }

  async function openWhatsApp() {
    const lead = await selectedLead();

    if (!lead) {
      notify("Choose a saved lead first.");
      return;
    }

    const digits = String(lead.phone || "")
      .replace(/\D/g, "");

    if (digits.length < 8 || digits.length > 15) {
      notify(
        "This lead has no usable phone number. Check the source page first."
      );
      return;
    }

    const message = $("message-output").value.trim() ||
      await prepareMessage();

    if (!message) return;

    window.open(
      `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function startQueue() {
    const rows = await allLeads();

    queue = rows.filter(row => {
      const digits = String(row.phone || "")
        .replace(/\D/g, "");

      return row.url &&
        digits.length >= 8 &&
        digits.length <= 15;
    });

    queueIndex = 0;

    if (!queue.length) {
      $("queue-status").textContent =
        "No saved leads with usable phone numbers. Search and save leads first.";
      return;
    }

    switchView("campaigns");
    await openQueueLead();
  }

  async function openQueueLead() {
    if (queueIndex >= queue.length) {
      $("queue-status").textContent =
        "Queue complete. You reached the end of the saved contacts.";
      $("queue-next").disabled = true;
      return;
    }

    const lead = queue[queueIndex];

    $("campaign-lead").value = lead.url;
    await prepareMessage();

    $("queue-status").textContent =
      `Contact ${queueIndex + 1} of ${queue.length}: ${lead.name}. Review the draft and click “Open current WhatsApp”. After you finish, click “Next contact”.`;

    $("queue-next").disabled = false;
  }

  async function nextQueueLead() {
    if (!queue.length) {
      $("queue-status").textContent = "Start the queue first.";
      return;
    }

    queueIndex++;

    if (queueIndex >= queue.length) {
      $("queue-status").textContent = "Queue complete.";
      $("queue-next").disabled = true;
      return;
    }

    await openQueueLead();
  }

  function stopQueue() {
    queue = [];
    queueIndex = 0;
    $("queue-next").disabled = true;
    $("queue-status").textContent = "Queue stopped.";
  }

  function exportCsv() {
    allLeads().then(rows => {
      if (!rows.length) {
        notify("There are no leads to export.");
        return;
      }

      const fields = [
        "name",
        "url",
        "snippet",
        "source",
        "location",
        "market",
        "skill",
        "phone",
        "email",
        "status"
      ];

      const csv = [
        fields.join(","),
        ...rows.map(row =>
          fields.map(key =>
            `"${String(row[key] ?? "").replace(/"/g, '""')}"`
          ).join(",")
        )
      ].join("\r\n");

      const blob = new Blob(
        [csv],
        { type: "text/csv;charset=utf-8;" }
      );

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

    if (nav) {
      switchView(nav.dataset.view);
    }

    const save = event.target.closest("[data-save-id]");

    if (save) {
      const lead = (await allLeads()).find(
        row => String(row.id) === save.dataset.saveId
      );

      if (lead) {
        switchView("campaigns");
        $("campaign-lead").value = lead.url;
        await prepareMessage();
      }
    }

    const status = event.target.closest("[data-status-id]");

    if (status) {
      await updateLead(status.dataset.statusId, status.value);
    }
  });

  $("skill").addEventListener("change", () => {
    $("custom-skill-wrap").hidden =
      $("skill").value !== "custom skill";
  });

  $("search-button").addEventListener(
    "click",
    searchLeads
  );

  $("generate-message").addEventListener(
    "click",
    prepareMessage
  );

  $("copy-message").addEventListener("click", async () => {
    const text = $("message-output").value;

    if (!text) {
      notify("Generate a message first.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      notify("Message copied.");
    } catch {
      $("message-output").select();
      document.execCommand("copy");
      notify("Message copied.");
    }
  });

  $("whatsapp-message").addEventListener(
    "click",
    openWhatsApp
  );

  $("queue-start").addEventListener(
    "click",
    startQueue
  );

  $("queue-next").addEventListener(
    "click",
    nextQueueLead
  );

  $("queue-stop").addEventListener(
    "click",
    stopQueue
  );

  $("export-button").addEventListener(
    "click",
    exportCsv
  );

  $("saved-export-button").addEventListener(
    "click",
    exportCsv
  );

  $("auth-button").addEventListener("click", async () => {
    if (user) {
      const { error } = await supabase.auth.signOut();

      if (error) {
        notify(error.message);
      } else {
        user = null;
        updateConnection();
        await renderAll();
      }
    } else {
      $("auth-dialog").showModal();
    }
  });

  $("sign-in-button").addEventListener("click", async () => {
    if (!supabase) {
      setAuthStatus(
        "Supabase is not configured. Check config.js.",
        "error"
      );
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: $("auth-email").value.trim(),
      password: $("auth-password").value
    });

    setAuthStatus(
      error ? error.message : "Signed in.",
      error ? "error" : "success"
    );

    if (!error) {
      $("auth-dialog").close();
      await renderAll();
    }
  });

  $("sign-up-button").addEventListener("click", async () => {
    if (!supabase) {
      setAuthStatus(
        "Supabase is not configured. Check config.js.",
        "error"
      );
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: $("auth-email").value.trim(),
      password: $("auth-password").value
    });

    setAuthStatus(
      error
        ? error.message
        : "Account request submitted. Check your email if confirmation is enabled.",
      error ? "error" : "success"
    );
  });

  initSupabase();
})();
