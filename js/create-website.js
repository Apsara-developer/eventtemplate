(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(tab => tab.addEventListener("click", () => {
    tabs.forEach(x => x.classList.toggle("active", x === tab));
    $("aiPanel").classList.toggle("hidden", tab.dataset.tab !== "ai");
    $("templatesPanel").classList.toggle("hidden", tab.dataset.tab !== "templates");
  }));
  document.querySelectorAll("[data-prompt]").forEach(btn => btn.addEventListener("click", () => { $("websitePrompt").value = btn.dataset.prompt; $("websitePrompt").focus(); }));

  let templateData = [];
  async function loadTemplates() {
    const grid = $("templateGrid");
    try {
      const response = await fetch("/api/templates");
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Unable to load templates.");
      templateData = data.categories || [];
      renderTemplates();
    } catch (e) { grid.innerHTML = `<p>${escapeText(e.message)}</p>`; }
  }
  function escapeText(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function renderTemplates() {
    const query = $("templateSearch").value.trim().toLowerCase();
    const categories = templateData.map(cat => ({...cat, templates: cat.templates.filter(t => `${cat.name} ${t.name} ${t.file}`.toLowerCase().includes(query))})).filter(c => c.templates.length);
    $("templateGrid").innerHTML = categories.length ? categories.map(cat => `<article class="category-card"><h3>${escapeText(cat.name)}</h3>${cat.templates.map(t => `<a class="template-link" href="editor.html?template=${encodeURIComponent(t.path)}"><span>${escapeText(t.name)}</span><b>EDIT →</b></a>`).join("")}</article>`).join("") : "<p>No matching templates found.</p>";
  }
  $("templateSearch").addEventListener("input", renderTemplates);
  loadTemplates();

  $("generateBtn").addEventListener("click", async () => {
    const prompt = $("websitePrompt").value.trim();
    const file = $("flyerFile").files[0];
    const projectName = $("projectName").value.trim();
    const design = $("designStyle").value;
    if (!prompt && !projectName && !file) { $("generationStatus").textContent = "Please describe your website idea. Flyer upload is optional."; $("websitePrompt").focus(); return; }
    if (file && file.size > 10 * 1024 * 1024) { $("generationStatus").textContent = "Please choose a file smaller than 10 MB."; return; }
    const btn = $("generateBtn"); btn.disabled = true; btn.innerHTML = "Generating locally...";
    $("generationStatus").textContent = "Connecting to your local AI model. This may take a minute...";
    try {
      const form = new FormData();
      form.append("prompt", prompt || `Create a website for ${projectName}.`);
      form.append("eventName", projectName);
      form.append("design", design);
      if (file) form.append("flyer", file);
      const response = await fetch("/api/generate-website", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Website generation failed.");
      localStorage.setItem("aram-generated-website", result.html);
      localStorage.setItem("aram-generated-title", projectName || "AI Generated Website");
      $("generationStatus").textContent = "Website generated. Opening the visual editor...";
      location.href = "editor.html?generated=1";
    } catch (e) { $("generationStatus").textContent = e.message; }
    finally { btn.disabled = false; btn.innerHTML = "✦ Generate my website <span>→</span>"; }
  });
})();