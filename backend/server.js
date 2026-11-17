require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { createWorker } = require("tesseract.js");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 5000);
const FRONTEND = path.join(__dirname, "..");
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:0.5b";
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const sessions = new Map();
fs.mkdirSync(DATA_DIR, { recursive: true });

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
  catch (_) { return []; }
}
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key.toString("hex"))));
}
function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const part = header.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}
function requireLogin(req, res, next) {
  const sid = getCookie(req, "aram_sid");
  const user = sessions.get(sid);
  if (!user) return res.status(401).json({ success: false, message: "Please log in to continue." });
  req.user = user;
  next();
}

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(express.static(FRONTEND, { index: false }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only JPG, PNG, WEBP and PDF files are supported."));
  }
});

function uploadMiddleware(req, res, next) {
  upload.single("flyer")(req, res, err => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });
}

async function extractFlyerText(file) {
  if (!file) return "";
  if (file.mimetype === "application/pdf") {
    const result = await pdfParse(file.buffer);
    return (result.text || "").trim();
  }
  if (file.mimetype.startsWith("image/")) {
    const worker = await createWorker("eng", 1, { langPath: __dirname, gzip: false });
    try {
      const result = await worker.recognize(file.buffer);
      return (result.data.text || "").trim();
    } finally { await worker.terminate(); }
  }
  throw new Error("Unsupported flyer format.");
}

function extractEventDetails(text) {
  const lines = String(text || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const full = lines.join(" ");
  const months = "January|February|March|April|May|June|July|August|September|October|November|December";
  const date = full.match(new RegExp(`\\b(?:\\d{1,2}[/.\\-]\\d{1,2}[/.\\-]\\d{2,4}|\\d{1,2}\\s+(?:${months})\\s+\\d{4}|(?:${months})\\s+\\d{1,2},?\\s+\\d{4})\\b`, "i"));
  const time = full.match(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM|A\.M\.|P\.M\.)\b/i);
  const venue = full.match(/\b(?:venue|location|address|held at)\s*[:\-]?\s*([^,\n]+(?:,\s*[^,\n]+)?)/i);
  const eventName = lines.find(x => x.length >= 4 && !/^(date|time|venue|location|register|contact|email)\b/i.test(x)) || "";
  const description = lines.filter(x => x.length > 35).slice(0, 5).join(" ");
  return { eventName, eventDate: date?.[0] || "", eventTime: time?.[0] || "", venue: venue?.[1]?.trim() || "", description };
}

app.get("/", (req, res) => res.sendFile(path.join(FRONTEND, "login.html")));

// Simple local account system: no JWT, no API secret, no external auth service.
app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 80);
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) {
      return res.status(400).json({ success: false, message: "Enter your name, a valid email and a password with at least 6 characters." });
    }
    const users = readUsers();
    if (users.some(u => u.email === email)) return res.status(409).json({ success: false, message: "An account with this email already exists." });
    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = await hashPassword(password, salt);
    users.push({ id: crypto.randomUUID(), name, email, salt, passwordHash, createdAt: new Date().toISOString() });
    writeUsers(users);
    res.json({ success: true, message: "Account created. You can now log in." });
  } catch (e) { res.status(500).json({ success: false, message: "Could not create account." }); }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const user = readUsers().find(u => u.email === email);
    if (!user) return res.status(401).json({ success: false, message: "Invalid email or password." });
    const supplied = Buffer.from(await hashPassword(password, user.salt), "hex");
    const stored = Buffer.from(user.passwordHash, "hex");
    if (supplied.length !== stored.length || !crypto.timingSafeEqual(supplied, stored)) return res.status(401).json({ success: false, message: "Invalid email or password." });
    const sid = crypto.randomBytes(32).toString("hex");
    sessions.set(sid, { id: user.id, name: user.name, email: user.email });
    res.setHeader("Set-Cookie", `aram_sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
    res.json({ success: true, user: { name: user.name, email: user.email } });
  } catch (e) { res.status(500).json({ success: false, message: "Login failed." }); }
});
app.post("/api/auth/logout", (req, res) => {
  const sid = getCookie(req, "aram_sid");
  sessions.delete(sid);
  res.setHeader("Set-Cookie", "aram_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ success: true });
});
app.get("/api/auth/me", requireLogin, (req, res) => res.json({ success: true, user: req.user }));
app.get("/api/health", async (req, res) => {
  let ollamaConnected = false;
  try { const r = await fetch(`${OLLAMA_URL}/api/tags`); ollamaConnected = r.ok; } catch (_) {}
  res.json({ success: true, message: "Aram Events backend is running", provider: "Local Ollama", model: OLLAMA_MODEL, ollamaConnected });
});

app.get("/api/templates", (req, res) => {
  const root = path.join(FRONTEND, "templates");
  const categories = [];
  if (!fs.existsSync(root)) return res.json({ success: true, categories });
  for (const folder of fs.readdirSync(root, { withFileTypes: true })) {
    if (!folder.isDirectory() || folder.name === "event-builder") continue;
    const dir = path.join(root, folder.name);
    const templates = fs.readdirSync(dir).filter(f => /^\d.*\.html$/i.test(f)).map(file => ({
      name: file.replace(/\.html$/i, "").replace(/^\d+[-_]?/, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      file,
      path: `templates/${folder.name}/${file}`
    }));
    categories.push({ name: folder.name.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase()), folder: folder.name, templates });
  }
  res.json({ success: true, categories });
});

app.post("/api/extract-flyer", requireLogin, uploadMiddleware, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Please upload an event flyer." });
    const extractedText = await extractFlyerText(req.file);
    if (!extractedText) return res.status(422).json({ success: false, message: "No readable text found in the flyer." });
    res.json({ success: true, message: "Flyer details extracted.", data: extractEventDetails(extractedText), extractedText });
  } catch (e) { res.status(500).json({ success: false, message: e.message || "Flyer extraction failed." }); }
});


function escapeHTML(value) { return String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function renderProfessionalWebsite(data, design) {
  const title = escapeHTML(data.eventName || "Your Next Great Event");
  const description = escapeHTML(data.description || "A gathering for ideas, inspiration and meaningful connections.");
  const date = escapeHTML(data.eventDate || "Date to be announced");
  const time = escapeHTML(data.eventTime || "Schedule to be announced");
  const venue = escapeHTML(data.venue || "Venue to be announced");
  const dark = /dark|premium/i.test(design || "");
  const bg = dark ? "#101426" : "#f5f1e9", ink = dark ? "#f7f5ff" : "#202235", accent = dark ? "#a99aff" : "#6c4ee8";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;600;700;800&display=swap" rel="stylesheet"><style>*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:${bg};color:${ink};font-family:'DM Sans',sans-serif}a{color:inherit;text-decoration:none}.nav{height:78px;display:flex;align-items:center;justify-content:space-between;padding:0 7%;border-bottom:1px solid ${dark?'#ffffff20':'#24243a18'}}.brand{font:800 17px Manrope;letter-spacing:1px}.nav a:last-child,.cta{background:${accent};color:white;padding:13px 20px;border-radius:5px;font-weight:700;font-size:12px}.hero{padding:100px 8% 90px;min-height:570px;display:flex;align-items:center;background:radial-gradient(ellipse at 85% 20%,${accent}45,transparent 38%),linear-gradient(130deg,${bg},${dark?'#191c36':'#e9e1d5'})}.hero-inner{max-width:900px}.eyebrow{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${accent};font-weight:800}.hero h1{font:800 clamp(48px,8vw,96px)/.99 Manrope;letter-spacing:-5px;margin:24px 0;max-width:950px}.hero p{max-width:590px;font-size:16px;line-height:1.8;opacity:.75}.meta{display:flex;gap:28px;flex-wrap:wrap;margin:30px 0;font-size:12px;font-weight:700}.meta span{border-left:2px solid ${accent};padding-left:12px}.section{padding:90px 8%;display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center}.section h2{font:800 clamp(30px,4vw,48px)/1.1 Manrope;letter-spacing:-2px;margin:15px 0}.section p{line-height:1.9;opacity:.72;font-size:14px}.feature{background:${dark?'#ffffff0c':'#fff'};border:1px solid ${dark?'#ffffff20':'#24243a12'};padding:36px;min-height:220px}.feature strong{font:800 50px Manrope;color:${accent}}.feature p{margin-bottom:0}.band{padding:65px 8%;background:${dark?'#ffffff0b':'#e9e3f5'};display:flex;justify-content:space-between;align-items:center;gap:30px;flex-wrap:wrap}.band h2{font:800 34px Manrope;margin:0}.footer{padding:35px 8%;font-size:11px;opacity:.6;border-top:1px solid ${dark?'#ffffff20':'#24243a18'}}@media(max-width:700px){.nav{padding:0 5%}.hero{padding:75px 6%;min-height:500px}.hero h1{letter-spacing:-2.5px}.section{padding:65px 6%;grid-template-columns:1fr;gap:25px}.band{padding:50px 6%}}</style></head><body><nav class="nav"><div class="brand">${title.toUpperCase()}</div><a href="#register">REGISTER ↗</a></nav><header class="hero"><div class="hero-inner"><div class="eyebrow">AN EXPERIENCE WORTH SHOWING UP FOR</div><h1>${title}</h1><p>${description}</p><div class="meta"><span>◷ ${date}</span><span>⌖ ${venue}</span><span>◉ ${time}</span></div><a class="cta" href="#register">BE PART OF IT&nbsp; ↗</a></div></header><section class="section"><div><div class="eyebrow">THE EXPERIENCE</div><h2>Ideas become memorable when we experience them together.</h2><p>${description}</p></div><div class="feature"><strong>01</strong><h3>Discover something new.</h3><p>Connect, learn and take part in an experience designed to bring people together.</p></div></section><section class="band" id="register"><div><div class="eyebrow">SAVE YOUR PLACE</div><h2>Your next chapter starts here.</h2></div><a class="cta" href="mailto:hello@example.com?subject=${encodeURIComponent(data.eventName || 'Event Registration')}">REGISTER YOUR INTEREST ↗</a></section><footer class="footer">© ${new Date().getFullYear()} ${title}. All rights reserved.</footer></body></html>`;
}

function buildPrompt(data, prompt, design) {
  return `You are an expert web designer and frontend engineer. Create a complete, polished, original, responsive multi-section website as ONE standalone HTML document.\n\nUSER'S WEBSITE IDEA:\n${prompt || "Create a professional event website using the supplied details."}\n\nDETAILS EXTRACTED OR ENTERED BY USER (treat missing fields as unknown):\n${JSON.stringify(data, null, 2)}\n\nDESIGN DIRECTION:\n${design || "Choose a visual style that best fits the user's idea."}\n\nREQUIREMENTS:\n- Return only a complete HTML document, no Markdown fences or explanation.\n- Use semantic HTML, embedded CSS and vanilla JavaScript only. No React/Vue or remote API calls.\n- Build a visually distinctive design, not a generic plain template. Use strong typography, spacing, color system, responsive grids, accessible contrast and tasteful motion.\n- Include navigation, hero, relevant content sections, footer and mobile navigation. Sections must match the user's website idea; for event sites include overview, schedule, speakers/guests only when supplied, venue and registration call-to-action. For non-event sites create appropriate sections instead.\n- Do not invent factual names, dates, addresses, phone numbers, sponsors, speakers or links. Use clearly labelled placeholders or omit unknown facts.\n- Use CSS gradients, shapes and safe remote image URLs only when appropriate; never use broken local image paths.\n- All nav links must point to real section IDs. Ensure layout works on desktop, tablet and mobile.\n- Include helpful editable text and meaningful content. Make it ready for the visual editor.\n- Keep code complete and valid. Start with <!DOCTYPE html>.`;
}

function cleanHTML(value) {
  let html = String(value || "").trim().replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/i, "");
  const start = html.search(/<!doctype html|<html\b/i);
  if (start > 0) html = html.slice(start);
  if (!/<html\b/i.test(html) || !/<head\b/i.test(html) || !/<body\b/i.test(html)) throw new Error("The local model did not return a complete HTML page. Try a shorter prompt or another model.");
  return html;
}

app.post("/api/generate-website", requireLogin, uploadMiddleware, async (req, res) => {
  try {
    const { prompt = "", eventName = "", eventDate = "", eventTime = "", venue = "", description = "", extractedText = "", design = "" } = req.body || {};
    if (!String(prompt).trim() && !eventName && !eventDate && !venue && !description && !extractedText && !req.file) {
      return res.status(400).json({ success: false, message: "Enter a website idea or provide details. Flyer upload is optional." });
    }
    let flyerText = extractedText;
    if (req.file) flyerText = [flyerText, await extractFlyerText(req.file)].filter(Boolean).join("\n");
    const extracted = extractEventDetails(flyerText);
    const data = {
      eventName: eventName || extracted.eventName,
      eventDate: eventDate || extracted.eventDate,
      eventTime: eventTime || extracted.eventTime,
      venue: venue || extracted.venue,
      description: description || extracted.description,
      flyerText
    };
    const fullPrompt = `Return compact JSON only with title, subtitle and description for this event website. Do not invent facts. Event details: ${JSON.stringify(data)}. User idea: ${prompt}. Design: ${design}.`;
    let response;
    try {
      response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt: fullPrompt, stream: false, format: "json", options: { temperature: 0.35, num_ctx: 1024, num_predict: 180 } })
      });
    } catch (_) {
      return res.status(503).json({ success: false, message: `Cannot connect to Ollama at ${OLLAMA_URL}. Install/start Ollama and pull model ${OLLAMA_MODEL}.` });
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(502).json({ success: false, message: payload.error || "Local AI model request failed. Check that the model is installed." });
    let aiCopy = {};
    try { aiCopy = JSON.parse(payload.response || "{}"); } catch (_) {}
    const renderData = {
      ...data,
      eventName: data.eventName || aiCopy.title || "Your Next Great Event",
      description: data.description || aiCopy.description || aiCopy.subtitle || "A gathering for ideas, inspiration and meaningful connections."
    };
    const html = renderProfessionalWebsite(renderData, design);
    res.json({ success: true, message: "Website generated with local Ollama, flyer extraction and the Aram design renderer.", html, eventData: renderData, provider: "Local Ollama", model: OLLAMA_MODEL });
  } catch (e) {
    console.error("WEBSITE GENERATION ERROR", e);
    res.status(500).json({ success: false, message: e.message || "Unable to generate website." });
  }
});

app.post("/api/publish", requireLogin, (req, res) => {
  try {
    const html = String(req.body?.html || "");
    const raw = String(req.body?.slug || "my-website").toLowerCase();
    const slug = raw.replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "my-website";
    if (!/<html\b/i.test(html) || !/<body\b/i.test(html)) return res.status(400).json({ success: false, message: "Valid website HTML is required." });
    const dir = path.join(FRONTEND, "published", slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), html, "utf8");
    res.json({ success: true, message: "Website published to your local server.", url: `/published/${slug}/` });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.use("/api", (req, res) => res.status(404).json({ success: false, message: `API route not found: ${req.method} ${req.originalUrl}` }));
app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, message: err.message || "Internal server error." });
});

app.listen(PORT, () => {
  console.log("\n====================================");
  console.log(" ARAM EVENTS - LOCAL AI WEBSITE BUILDER");
  console.log("====================================");
  console.log(`App:     http://localhost:${PORT}`);
  console.log(`Editor:  http://localhost:${PORT}/editor.html`);
  console.log(`Health:  http://localhost:${PORT}/api/health`);
  console.log(`AI:      Ollama / ${OLLAMA_MODEL}`);
  console.log("====================================\n");
});
