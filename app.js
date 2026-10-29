(() => {
  "use strict";
  const cfg = window.LEADPILOT_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR_PROJECT_REF") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "leadpilot_leads_v1";
  let supabase = null, user = null, currentLeads = [], currentView = "dashboard";
  let toastTimer;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const safeUrl = (s) => { try { const u = new URL(s); return ["http:","https:"].includes(u.protocol) ? u.href : "#"; } catch { return "#"; } };
  const localLeads = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; } };
  const setLocalLeads = (rows) => localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  const notify = (msg) => { const t=$("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("show"),2800); };
  const statusText = (msg, type="") => { const el=$("search-status"); el.textContent=msg; el.className="status-line "+type; };
  const authStatus = (msg, type="") => { const el=$("auth-status"); el.textContent=msg; el.className="status-line "+type; };
  const online = () => Boolean(supabase && user);

  async function initSupabase() {
    if (!configured) { updateConnection(); renderAll(); return; }
    try {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
      supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const { data } = await supabase.auth.getSession();
      user = data?.session?.user || null;
      supabase.auth.onAuthStateChange((_event, session) => {
        user = session?.user || null; updateConnection(); renderAll(); if(user) syncLocalToCloud();
      });
      updateConnection(); renderAll();
    } catch (e) { console.error(e); updateConnection("Supabase SDK could not load. Check your internet connection."); }
  }
  function updateConnection(error) {
    const dot=$("connection-dot");
    dot.classList.toggle("online", online());
    $("connection-title").textContent = online() ? "Cloud sync connected" : configured ? "Sign in to sync" : "Local preview mode";
    $("connection-subtitle").textContent = online() ? "Your leads sync to Supabase" : error || (configured ? "Sign in to access your workspace" : "Connect Supabase to sync");
    $("user-label").textContent = user?.email || "Local workspace";
    $("auth-button").textContent = user ? "Sign out" : configured ? "Sign in / Create account" : "Set up Supabase";
  }
  async function allLeads() {
    if (online()) {
      const { data, error } = await supabase.from("leads").select("*").order("created_at",{ascending:false}).limit(1000);
      if (!error && data) return data.map(fromDb);
      console.error("Could not load cloud leads:",error);
    }
    return localLeads();
  }
  function fromDb(r) { return { id:r.id, name:r.name, url:r.url, snippet:r.snippet||"", source:r.source||"web", location:r.location||"", skill:r.skill||"", status:r.status||"New", phone:r.phone||"", email:r.email||"", created_at:r.created_at, user_id:r.user_id }; }
  async function saveLead(lead) {
    const normalized = { ...lead, id: lead.id || crypto.randomUUID(), status: lead.status || "New" };
    const rows=localLeads();
    if (!rows.some(r => (r.url && r.url===normalized.url) || r.id===normalized.id)) { rows.unshift(normalized); setLocalLeads(rows); }
    if (online()) {
      const payload={ user_id:user.id, name:normalized.name, url:normalized.url, snippet:normalized.snippet, source:normalized.source, location:normalized.location, skill:normalized.skill, status:normalized.status, phone:normalized.phone||null, email:normalized.email||null, external_id:normalized.external_id||null };
      const { error } = await supabase.from("leads").upsert(payload,{onConflict:"user_id,url",ignoreDuplicates:true});
      if (error) console.error("Cloud save error:",error);
    }
  }
  async function updateLead(id, status) {
    let rows=localLeads().map(r=>r.id===id?{...r,status}:r); setLocalLeads(rows);
    if(online()) { const {error}=await supabase.from("leads").update({status}).eq("id",id); if(error) console.error(error); }
    renderAll();
  }
  async function syncLocalToCloud() {
    if(!online()) return;
    const rows=localLeads(); if(!rows.length) return;
    const payload=rows.map(r=>({user_id:user.id,name:r.name,url:r.url,snippet:r.snippet||"",source:r.source||"web",location:r.location||"",skill:r.skill||"",status:r.status||"New",phone:r.phone||null,email:r.email||null,external_id:r.external_id||null}));
    const {error}=await supabase.from("leads").upsert(payload,{onConflict:"user_id,url",ignoreDuplicates:true});
    if(!error) notify("Browser leads synced to your account.");
  }
  function getSkill() { return $("skill").value==="custom skill" ? $("custom-skill").value.trim() : $("skill").value; }
  function buildQueries(skill, location, businessType) {
    const s=skill.toLowerCase(), loc=location && location.toLowerCase()!=="worldwide" ? ` "${location}"` : "";
    const type=businessType ? `${businessType} ` : "";
    let ideas=[];
    if(/excel|data|analytics|power bi|spreadsheet/.test(s)) ideas=[`${type}business needs Excel dashboard reporting spreadsheet automation${loc}`,`${type}company hiring freelance data analyst Excel reporting${loc}`,`${type}business data entry spreadsheet cleanup services${loc}`];
    else if(/video|edit|reel|short/.test(s)) ideas=[`${type}business looking for video editor reels${loc}`,`${type}brand social media video content${loc}`,`${type}business promotional video production${loc}`];
    else if(/website|web design|development/.test(s)) ideas=[`${type}business website redesign web design${loc}`,`${type}small business needs website landing page${loc}`,`${type}business no website contact details${loc}`];
    else if(/social media|content strategy|instagram/.test(s)) ideas=[`${type}business social media management content marketing${loc}`,`${type}business Instagram content inconsistent${loc}`,`${type}company looking for social media manager${loc}`];
    else if(/graphic|logo|design|canva/.test(s)) ideas=[`${type}business logo designer branding design${loc}`,`${type}small business promotional creatives poster design${loc}`,`${type}brand needs graphic design support${loc}`];
    else if(/bookkeep|account|financial/.test(s)) ideas=[`${type}small business bookkeeping accounting spreadsheet support${loc}`,`${type}business part-time bookkeeper accounting support${loc}`,`${type}business financial reporting bookkeeping services${loc}`];
    else ideas=[`${type}business needs ${skill}${loc}`,`${type}companies hiring freelance ${skill}${loc}`,`${type}business looking for ${skill} services${loc}`];
    return ideas;
  }
  async function searchLeads() {
    const skill=getSkill(), location=$("location").value.trim()||"Worldwide", businessType=$("business-type").value.trim();
    const source=$("source").value, freshness=$("freshness").value, count=Number($("count").value);
    if(!skill){statusText("Choose a skill or enter a custom skill.","error");return;}
    const button=$("search-button"); button.disabled=true; button.textContent="Searching…"; statusText("Preparing skill-specific queries…");
    try {
      if(online()) {
        const {data,error}=await supabase.functions.invoke("search-leads",{body:{skill,location,businessType,source,freshness,count,queries:buildQueries(skill,location,businessType)}});
        if(error) throw new Error(error.message||"Search function failed.");
        const results=data?.results||[];
        if(!results.length) { statusText(data?.message||"No results returned. Check source API setup and try a broader query.","error"); currentLeads=[]; renderResults(); return; }
        const existing=await allLeads();
        const seen=new Set(existing.map(r=>r.url).filter(Boolean));
        let added=0;
        for(const r of results) {
          if(!r.url || seen.has(r.url)) continue;
          seen.add(r.url);
          await saveLead({...r,skill,location,status:"New"});
          added++;
        }
        currentLeads=results.map(r=>({...r,skill,location,status:seen.has(r.url)?"New":r.status||"New"}));
        statusText(`Found ${results.length} results; ${added} new leads saved. Review each prospect before outreach.`,"success");
      } else {
        const queries=buildQueries(skill,location,businessType);
        statusText(
  configured
    ? "Sign in to Supabase to run a live lead search."
    : "Supabase is not configured. Check config.js first.",
  "error"
);
        currentLeads=queries.map((q,i)=>({id:"query-"+i,name:"Search query "+(i+1),url:"https://search.brave.com/search?q="+encodeURIComponent(q),snippet:q,source:"Search plan",location,skill,status:"Query only"}));
      }
      renderResults();
    } catch(e) {
      console.error(e);
      statusText((e.message||"Search failed.")+" Check Supabase URL/key, Edge Function deployment, and provider secrets.","error");
    } finally { button.disabled=false; button.innerHTML="<span>⌕</span> Find relevant leads"; renderAll(); }
  }
  function leadRow(lead, isSaved=false) {
    const id=esc(lead.id||lead.url);
    const title=esc(lead.name||"Untitled result"), url=safeUrl(lead.url);
    const source=esc(lead.source||"web"), location=esc(lead.location||"");
    const status=esc(lead.status||"New");
    return `<tr><td><a class="lead-title" href="${url}" target="_blank" rel="noopener noreferrer">${title}</a><div class="lead-meta">${location}</div><div class="lead-meta">${esc(lead.skill||"")}</div></td><td><div class="match-note">${esc(lead.snippet||"Review the source to assess fit.")}</div></td><td><a class="source-link" href="${url}" target="_blank" rel="noopener noreferrer">${source} ↗</a></td><td><select class="status-select" data-status-id="${id}" aria-label="Lead status"><option ${status==="New"?"selected":""}>New</option><option ${status==="Review"?"selected":""}>Review</option><option ${status==="Contacted"?"selected":""}>Contacted</option><option ${status==="Replied"?"selected":""}>Replied</option><option ${status==="Not a fit"?"selected":""}>Not a fit</option></select></td><td><button class="small-action" data-campaign-id="${id}">${isSaved?"Draft ↗":"Save +"}</button></td></tr>`;
  }
  function renderResults() {
    const rows=$("lead-rows");
    if(!currentLeads.length) { rows.innerHTML='<tr><td colspan="5" class="empty-state"><span>⌕</span><b>No live results to show</b><small>Run a search after connecting Supabase and a lead source.</small></td></tr>'; return; }
    rows.innerHTML=currentLeads.map(l=>leadRow(l,false)).join("");
    rows.querySelectorAll("[data-campaign-id]").forEach(btn=>btn.addEventListener("click",async()=>{
      const lead=currentLeads.find(l=>String(l.id||l.url)===btn.dataset.campaignId);
      if(lead){await saveLead({...lead,status:"New"}); notify("Lead saved."); await renderAll(); setCampaignLead(lead.url);}
    }));
    attachStatusHandlers(rows);
  }
  function attachStatusHandlers(root) {
    root.querySelectorAll("[data-status-id]").forEach(sel=>sel.addEventListener("change",async()=>{
      const id=sel.dataset.statusId; await updateLead(id,sel.value); notify("Lead status updated.");
    }));
    root.querySelectorAll("[data-campaign-id]").forEach(btn=>btn.addEventListener("click",async()=>{
      const lead=(await allLeads()).find(l=>String(l.id)===btn.dataset.campaignId || l.url===btn.dataset.campaignId);
      if(lead){setCampaignLead(lead.url);switchView("campaigns");}
    }));
  }
  function setCampaignLead(url) { const select=$("campaign-lead"); select.value=url||""; }
  async function renderAll() {
    const leads=await allLeads();
    $("saved-count").textContent=leads.length;
    $("stat-total").textContent=leads.length;
    $("stat-review").textContent=leads.filter(l=>["New","Review"].includes(l.status||"New")).length;
    $("stat-contacted").textContent=leads.filter(l=>["Contacted","Replied"].includes(l.status)).length;
    const saved=$("saved-rows");
    saved.innerHTML=leads.length?leads.map(l=>leadRow(l,true)).join(""):'<tr><td colspan="5" class="empty-state"><span>▤</span><b>No saved leads</b><small>Save a result from the dashboard.</small></td></tr>';
    attachStatusHandlers(saved);
    const options=$("campaign-lead");
    const previous=options.value;
    options.innerHTML='<option value="">Choose a lead…</option>'+leads.map(l=>`<option value="${esc(l.url)}">${esc(l.name)} — ${esc(l.skill||"")}</option>`).join("");
    if([...options.options].some(o=>o.value===previous)) options.value=previous;
  }
  function switchView(view) {
    currentView=view;
    ["dashboard","saved","campaigns"].forEach(v=>{$(v+"-view").hidden=v!==view;});
    document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
    $("page-title").textContent=({dashboard:"Find your next client",saved:"Your lead library",campaigns:"Outreach drafts"})[view];
    if(view!=="dashboard") renderAll();
  }
  function selectedCampaignLead() { return allLeads().then(leads=>leads.find(l=>l.url===$("campaign-lead").value)); }
  async function generateMessage() {
    const lead=await selectedCampaignLead();
    if(!lead){notify("Choose a saved lead first.");return;}
    const sender=$("sender-name").value.trim()||"Manan Singh";
    const offer=$("offer").value.trim()||lead.skill||"my services";
    const name=(lead.name||"there").split(/[-|,]/)[0].trim();
    $("message-output").value=`Hi ${name}, I came across your business while researching ${lead.location||"businesses"} and wanted to reach out. I’m ${sender}, and I help businesses with ${offer}. I had a couple of ideas that may be useful for your business. Would you be open to a brief conversation? If this isn’t relevant, no worries.`;
    notify("Draft created. Personalise it before sending.");
  }
  async function exportCsv() {
    const leads=await allLeads();
    if(!leads.length){notify("No saved leads to export.");return;}
    const cols=["name","url","snippet","source","location","skill","status","phone","email","created_at"];
    const csv=[cols.join(","),...leads.map(r=>cols.map(c=>`"${String(r[c]??"").replace(/"/g,'""')}"`).join(","))].join("\r\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob), a=document.createElement("a");a.href=url;a.download="leadpilot-leads.csv";a.click();URL.revokeObjectURL(url);
  }
  async function authAction(action) {
    if(!configured){notify("Open config.js and add your Supabase project URL and public anon key first.");return;}
    if(!supabase){notify("Supabase is still loading. Try again.");return;}
    if(action==="signout"){await supabase.auth.signOut();user=null;updateConnection();renderAll();$("auth-dialog").close();return;}
    const email=$("auth-email").value.trim(), password=$("auth-password").value;
    if(!email||password.length<8){authStatus("Enter a valid email and password with at least 8 characters.","error");return;}
    authStatus("Connecting…");
    const result=action==="signup"?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});
    if(result.error){authStatus(result.error.message,"error");return;}
    if(action==="signup"&&!result.data.session){authStatus("Account created. Check your email to confirm, then sign in.","success");return;}
    user=result.data.user; updateConnection(); await syncLocalToCloud(); await renderAll(); $("auth-dialog").close(); notify("Workspace connected.");
  }
  $("skill").addEventListener("change",()=>{$("custom-skill-wrap").hidden=$("skill").value!=="custom skill";});
  $("search-button").addEventListener("click",searchLeads);
  $("export-button").addEventListener("click",exportCsv);
  $("saved-export-button").addEventListener("click",exportCsv);
  document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));
  $("auth-button").addEventListener("click",()=>{if(user)authAction("signout");else if(configured)$("auth-dialog").showModal();else notify("Edit config.js to connect Supabase.");});
  $("sign-in-button").addEventListener("click",()=>authAction("signin"));
  $("sign-up-button").addEventListener("click",()=>authAction("signup"));
  $("generate-message").addEventListener("click",generateMessage);
  $("copy-message").addEventListener("click",async()=>{if(!$("message-output").value){notify("Generate a message first.");return;}try{await navigator.clipboard.writeText($("message-output").value);notify("Message copied.");}catch{notify("Clipboard permission unavailable; select and copy the text.");}});
  $("whatsapp-message").addEventListener("click",()=>{const lead=$("campaign-lead").value, message=$("message-output").value.trim();if(!lead||!message){notify("Choose a lead and generate a message first.");return;}const phone="";const url=phone?`https://wa.me/${phone}?text=${encodeURIComponent(message)}`:`https://wa.me/?text=${encodeURIComponent(message)}`;window.open(url,"_blank","noopener,noreferrer");});
  $("auth-dialog").addEventListener("click",e=>{if(e.target===$("auth-dialog"))$("auth-dialog").close();});
  initSupabase();
})();
