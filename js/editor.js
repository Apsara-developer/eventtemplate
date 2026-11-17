
(() => {
"use strict";

const API_BASE_URL = "http://localhost:5000";

const $ = id => document.getElementById(id);
const iframe = $("websitePreview");

const params = new URLSearchParams(location.search);
const requestedTemplate = params.get("template") || "";
const isGeneratedWebsite = params.get("generated") === "1";

const DRAFT_KEY =
    "aram-professional-" + (isGeneratedWebsite ? "generated" : (requestedTemplate || location.pathname));

const TEXT_SELECTOR =
    "h1,h2,h3,h4,h5,h6,p,a,button,li,span,label";

let currentTemplateURL = "";

let sections = [];
let selectedSection = null;
let selectedText = null;
let selectedImage = null;

let textNodesCache = [];
let imagesCache = [];

let flyerObjectURL = null;
let flyerDataURL = "";

let historyStack = [];
let historyIndex = -1;
let restoring = false;
let historyTimer = null;


/* BASIC HELPERS */

function status(message) {
    $("statusMessage").textContent = message;
}

function flyerStatus(message) {
    $("flyerStatus").textContent = message;
}

function doc() {
    try {
        return iframe.contentDocument ||
               iframe.contentWindow.document;
    } catch {
        return null;
    }
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[c]));
}


/* TEMPLATE LOADING */

function resolveTemplate(value) {

    if (
        !value ||
        value.includes("..") ||
        !/^(\.\/|\/)?templates\/.+\.html$/i.test(value)
    ) {
        return "";
    }

    return new URL(value, location.href).href;
}

function addBase(html) {

    if (!currentTemplateURL || /<base\b/i.test(html)) {
        return html;
    }

    const base =
        `<base href="${escapeHTML(currentTemplateURL)}">`;

    return /<head\b[^>]*>/i.test(html)
        ? html.replace(/<head\b[^>]*>/i, m => m + base)
        : html;
}

function cleanClone() {

    const d = doc();

    if (!d?.documentElement) return null;

    const clone = d.documentElement.cloneNode(true);

    clone.querySelector("#aram-editor-style")?.remove();

    clone.querySelectorAll(
        ".aram-selected-section,.aram-selected-element"
    ).forEach(e => {
        e.classList.remove(
            "aram-selected-section",
            "aram-selected-element"
        );
    });

    clone.querySelector("base")?.remove();

    clone.body?.removeAttribute("data-aram-installed");

    clone.querySelectorAll("[data-aram-hidden]").forEach(e => {
        e.removeAttribute("data-aram-hidden");
    });

    return clone;
}

function currentHTML() {

    const clone = cleanClone();

    return clone
        ? "<!DOCTYPE html>\n" + clone.outerHTML
        : "";
}

function loadTemplate() {

    currentTemplateURL = resolveTemplate(requestedTemplate);

    let saved = "";

    try {
        saved = localStorage.getItem(DRAFT_KEY) || "";
    } catch (e) {
        console.warn(e);
    }

    if (saved) {
        iframe.srcdoc = addBase(saved);
        return;
    }

    if (isGeneratedWebsite) {
        const generated = localStorage.getItem("aram-generated-website") || "";
        if (generated) {
            iframe.srcdoc = generated;
            return;
        }
    }

    if (currentTemplateURL) {
        iframe.src = currentTemplateURL;
        return;
    }

    iframe.srcdoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body {
    font-family: Arial;
    margin: 0;
    color: #182337;
}
section {
    padding: 70px 8%;
}
header {
    padding: 24px;
    background: #101827;
    color: white;
}
h1 {
    font-size: 48px;
}
img {
    max-width: 100%;
}
</style>
</head>
<body>
<header><strong>ARAM EVENTS</strong></header>
<main>
<section>
<h1>Your Event Website</h1>
<p>Select a template using ?template=templates/your-template.html, or start adding sections.</p>
</section>
</main>
</body>
</html>`;
}


/* EDITOR STYLES INSIDE PREVIEW */

function installStyles() {

    const d = doc();

    if (!d?.head) return;

    d.getElementById("aram-editor-style")?.remove();

    const s = d.createElement("style");

    s.id = "aram-editor-style";

    s.textContent = `
    .aram-selected-section {
        outline: 3px dashed #725cf4 !important;
        outline-offset: -4px !important;
    }

    .aram-selected-element {
        outline: 3px solid #14a66b !important;
        outline-offset: 2px !important;
    }

    [data-aram-hidden="true"] {
        display: none !important;
    }

    .aram-image-caption {
        font-size: 13px;
        color: #777;
        text-align: center;
        margin-top: 8px;
    }

    .aram-gallery {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 15px;
    }

    .aram-gallery img {
        width: 100%;
        height: 230px;
        object-fit: cover;
    }

    .aram-cards {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 18px;
    }

    .aram-card {
        padding: 24px;
        background: #f1f3f8;
        border-radius: 12px;
    }

    .aram-two-column {
        display: grid !important;
        grid-template-columns: repeat(2,minmax(0,1fr));
        gap: 25px;
        align-items: center;
    }

    .aram-masonry {
        columns: 3;
        column-gap: 15px;
    }

    .aram-masonry img {
        width: 100%;
        margin-bottom: 15px;
    }

    /* IMAGE FLEX LAYOUT */

    .aram-image-layout {
        display: flex;
        gap: 18px;
        align-items: stretch;
        width: 100%;
        max-width: 100%;
    }

    .aram-image-layout figure {
        margin: 0;
        min-width: 0;
        flex: 1 1 0;
    }

    .aram-image-layout figure img {
        display: block;
        width: 100%;
        max-width: 100%;
        height: 260px;
        object-fit: cover;
    }

    .aram-image-layout[data-layout="column"],
    .aram-image-layout[data-layout="column-reverse"] {
        align-items: stretch;
    }

    /* IMAGE GRID */

    .aram-image-layout[data-layout^="grid"] {
        display: grid;
        grid-template-columns:
            repeat(var(--aram-columns,2),minmax(0,1fr));
    }

    /* IMAGE MASONRY */

    .aram-image-layout[data-layout="masonry"] {
        display: block;
        columns: var(--aram-columns,3);
        column-gap: 18px;
    }

    .aram-image-layout[data-layout="masonry"] figure {
        display: inline-block;
        width: 100%;
        margin: 0 0 18px;
        break-inside: avoid;
    }

    /* FLEX WRAP */

    .aram-image-layout[data-layout="wrap"] {
        flex-wrap: wrap;
    }

    .aram-image-layout[data-layout="wrap"] figure {
        flex: 1 1 220px;
    }

    .aram-image-layout .aram-image-caption {
        margin: 8px 0 0;
    }

    /* RESPONSIVE PREVIEW */

    @media(max-width:700px) {

        .aram-gallery,
        .aram-cards,
        .aram-two-column {
            grid-template-columns: 1fr !important;
        }

        .aram-masonry {
            columns: 2;
        }

        .aram-image-layout {
            flex-direction: column !important;
        }

        .aram-image-layout[data-layout^="grid"] {
            grid-template-columns: repeat(2,minmax(0,1fr));
        }

        .aram-image-layout[data-layout="masonry"] {
            columns: 2;
        }
    }
    `;

    d.head.appendChild(s);
}


/* SECTION DISCOVERY */

function discoverSections() {

    const d = doc();

    if (!d?.body) return;

    const found = [];

    const header = d.querySelector("body > header");
    const footer = d.querySelector("body > footer");
    const main = d.querySelector("body > main");

    if (header) found.push(header);

    if (main) {
        Array.from(main.children).forEach(e => {

            if (
                !e.matches("script,style") &&
                (e.textContent.trim() || e.querySelector("img"))
            ) {
                found.push(e);
            }

        });
    }

    if (footer) found.push(footer);

    if (!found.length) {
        found.push(
            ...Array.from(
                d.querySelectorAll("section,article")
            ).filter(e =>
                !e.parentElement.closest("section,article")
            )
        );
    }

    sections = [...new Set(found)];

    if (!sections.includes(selectedSection)) {
        selectedSection = null;
    }

    renderSections();
    refreshElementLists();
}

function sectionName(s, i) {

    return s?.dataset.aramName ||
        s?.querySelector("h1,h2,h3,h4,h5,h6")
            ?.textContent.trim().slice(0,35) ||
        (
            s?.tagName === "HEADER"
                ? "Header / Navigation"
                : s?.tagName === "FOOTER"
                    ? "Footer"
                    : `Section ${i+1}`
        );
}


/* SECTION LIST UI */

function renderSections() {

    const list = $("sectionList");

    list.replaceChildren();

    $("sectionCount").textContent =
        String(sections.length).padStart(2,"0");

    sections.forEach((s,i) => {

        const item = document.createElement("div");

        item.className =
            "section-item" +
            (s === selectedSection ? " active" : "");

        const top = document.createElement("div");

        top.className = "section-top";

        const name = document.createElement("div");

        name.className = "section-name";

        name.textContent =
            `${String(i+1).padStart(2,"0")}  ${sectionName(s,i)}`;

        name.addEventListener("click", () => selectSection(s));

        const controls = document.createElement("div");

        controls.className = "section-controls";

        [["↑",-1],["↓",1]].forEach(([label,dir]) => {

            const b = document.createElement("button");

            b.type = "button";
            b.textContent = label;
            b.title = dir < 0 ? "Move up" : "Move down";
            b.disabled = !sections[i+dir];

            b.addEventListener("click", () =>
                moveSection(i,dir)
            );

            controls.appendChild(b);

        });

        top.append(name,controls);

        item.append(top);

        if (s.dataset.aramHidden === "true") {

            const h = document.createElement("div");

            h.className = "section-status";
            h.textContent = "Hidden";

            item.append(h);
        }

        list.append(item);

    });
}


/* SELECTION */

function clearSelection() {

    doc()?.querySelectorAll(
        ".aram-selected-section,.aram-selected-element"
    ).forEach(e => {
        e.classList.remove(
            "aram-selected-section",
            "aram-selected-element"
        );
    });

}

function colorValue(el,prop,fallback) {

    const raw = getComputedStyle(el)[prop];

    const m = raw?.match(/\d+/g);

    return m && m.length >= 3
        ? "#" + m.slice(0,3).map(x =>
            Number(x).toString(16).padStart(2,"0")
        ).join("")
        : fallback;
}

function selectSection(s) {

    if (!s) return;

    clearSelection();

    selectedSection = s;
    selectedText = null;
    selectedImage = null;

    s.classList.add("aram-selected-section");

    $("sectionNameInput").value =
        sectionName(s,sections.indexOf(s));

    $("sectionBackground").value =
        colorValue(s,"backgroundColor","#ffffff");

    $("sectionTextColor").value =
        colorValue(s,"color","#182337");

    $("sectionPadding").value =
        parseInt(s.style.paddingTop) || 50;

    $("paddingValue").textContent =
        $("sectionPadding").value + " px";

    $("sectionAlignment").value =
        s.style.textAlign || "left";

    $("sectionLayout").value =
        s.dataset.aramLayout || "default";

    const imageWrap = getImageLayoutContainer(s);

    if (imageWrap) {

        $("imageArrangement").value =
            imageWrap.dataset.layout || "row";

        $("imageGap").value =
            parseInt(imageWrap.style.gap) || 18;

        $("imageColumns").value =
            parseInt(
                imageWrap.style.getPropertyValue("--aram-columns")
            ) || 3;

    } else {

        $("imageArrangement").value = "row";
        $("imageGap").value = 18;
        $("imageColumns").value = 3;

    }

    renderSections();
    refreshElementLists();

    status("Selected: " + sectionName(s,sections.indexOf(s)));
}


/* UNDO AND REDO */

function recordHistory() {

    if (restoring) return;

    clearTimeout(historyTimer);

    historyTimer = setTimeout(() => {

        const html = currentHTML();

        if (!html) return;

        historyStack =
            historyStack.slice(0,historyIndex+1);

        if (historyStack[historyStack.length-1] !== html) {

            historyStack.push(html);

            if (historyStack.length > 40) {
                historyStack.shift();
            }

            historyIndex = historyStack.length-1;

        }

    },250);

}

function restoreHistory(i) {

    if (i < 0 || i >= historyStack.length) return;

    restoring = true;

    historyIndex = i;

    selectedSection = null;
    selectedText = null;
    selectedImage = null;

    iframe.srcdoc = addBase(historyStack[i]);

    restoring = false;

    status("History restored.");

}


/* SECTION CREATION HELPERS */

function makeP(d,t) {

    const p = d.createElement("p");

    p.textContent = t;

    return p;
}

function makeImg(d) {

    const img = d.createElement("img");

    img.src =
        "https://placehold.co/800x550?text=Upload+Image";

    img.alt = "New event image";

    img.style.cssText =
        "width:100%;max-width:100%;height:auto;object-fit:cover";

    return img;
}

function addCards(section,names) {

    const d = section.ownerDocument;

    const wrap = d.createElement("div");

    wrap.className = "aram-cards";

    names.forEach(n => {

        const card = d.createElement("div");

        card.className = "aram-card";

        const h = d.createElement("h3");

        h.textContent = n;

        card.append(
            h,
            makeP(d,"Add details here.")
        );

        wrap.append(card);

    });

    section.append(wrap);
}


/* ADD NEW SECTION */

function createSection(type) {

    const d = doc();

    if (!d?.body) return;

    const main = d.querySelector("main") || d.body;

    const s = d.createElement("section");

    s.className = "aram-added-section";

    s.dataset.aramName =
        type[0].toUpperCase() + type.slice(1);

    s.style.cssText =
        "padding:55px 7%;background:#fff;color:#182337;width:100%;box-sizing:border-box;text-align:left";

    const h = d.createElement("h2");

    const p = makeP(d,"Add your content here.");

    h.textContent =
        "New " + type[0].toUpperCase() + type.slice(1);

    switch(type) {

        case "image": {

            const img = makeImg(d);

            const cap = makeP(d,"Add image caption");

            cap.className = "aram-image-caption";

            s.append(img,cap);

            break;
        }

        case "image-text": {

            s.classList.add("aram-two-column");

            const wrap = d.createElement("div");

            wrap.append(h,p);

            s.append(makeImg(d),wrap);

            break;
        }

        case "gallery": {

            h.textContent = "Gallery";

            const g = d.createElement("div");

            g.className = "aram-gallery";

            for(let i=0;i<3;i++) {
                g.append(makeImg(d));
            }

            s.append(h,g);

            break;
        }

        case "contact":

            h.textContent = "Contact Us";

            s.append(
                h,
                makeP(d,"Email: your@email.com"),
                makeP(d,"Phone: Add phone number"),
                makeP(d,"Address: Add your event address")
            );

            break;

        case "speakers":

            h.textContent = "Our Speakers";

            s.append(h);

            addCards(s,[
                "Speaker One",
                "Speaker Two",
                "Speaker Three"
            ]);

            break;

        case "schedule":

            h.textContent = "Event Schedule";

            s.append(
                h,
                makeP(d,"09:00 AM – Registration"),
                makeP(d,"10:00 AM – Opening Session"),
                makeP(d,"11:00 AM – Main Programme")
            );

            break;

        case "cards":

            h.textContent = "Highlights";

            s.append(h);

            addCards(s,[
                "Card One",
                "Card Two",
                "Card Three"
            ]);

            break;

        case "testimonials":

            h.textContent = "What People Say";

            s.append(
                h,
                makeP(d,"Add a testimonial from an event attendee.")
            );

            break;

        case "video": {

            h.textContent = "Event Video";

            const v = d.createElement("video");

            v.controls = true;
            v.style.width = "100%";

            s.append(h,v);

            break;
        }

        case "location":

            h.textContent = "Our Location";

            s.append(
                h,
                makeP(d,"Add your venue and location details.")
            );

            break;

        default:

            s.append(h,p);

    }

    main.append(s);

    discoverSections();

    selectSection(s);

    recordHistory();

    status("New " + type + " section added.");

}


/* MOVE SECTIONS */

function moveSection(i,dir) {

    const s = sections[i];

    const target = sections[i+dir];

    if (
        !s ||
        !target ||
        s.parentElement !== target.parentElement
    ) {
        status("These sections cannot be moved between different containers.");
        return;
    }

    if (dir < 0) {
        target.before(s);
    } else {
        target.after(s);
    }

    discoverSections();

    selectSection(s);

    recordHistory();

}


/* TEXT AND IMAGE ELEMENT LISTS */

function refreshElementLists() {

    const ts = $("textElementSelect");

    const is = $("imageElementSelect");

    ts.replaceChildren(
        new Option("Select text","")
    );

    is.replaceChildren(
        new Option("Select image","")
    );

    textNodesCache = [];
    imagesCache = [];

    if (!selectedSection) return;

    textNodesCache = Array.from(
        selectedSection.querySelectorAll(TEXT_SELECTOR)
    ).filter(e => e.textContent.trim());

    imagesCache = Array.from(
        selectedSection.querySelectorAll("img")
    );

    textNodesCache.forEach((e,i) => {

        ts.add(
            new Option(
                e.tagName.toLowerCase() +
                " — " +
                e.textContent.trim().slice(0,35),
                String(i)
            )
        );

    });

    imagesCache.forEach((e,i) => {

        is.add(
            new Option(
                e.alt || "Image " + (i+1),
                String(i)
            )
        );

    });

}


/* SELECT TEXT */

function selectTextByIndex(value) {

    const el = textNodesCache[Number(value)];

    if (!el) return;

    selectedText = el;
    selectedImage = null;

    clearSelection();

    selectedSection?.classList.add("aram-selected-section");

    el.classList.add("aram-selected-element");

    $("textContentInput").value = el.textContent;

    $("fontSizeInput").value =
        parseInt(el.style.fontSize) ||
        parseInt(getComputedStyle(el).fontSize) ||
        16;

    $("fontWeightInput").value =
        el.style.fontWeight || "400";

    $("textAlignment").value =
        el.style.textAlign || "left";

}


/* IMAGE LAYOUT CONTAINER */

function getImageLayoutContainer(section) {

    if (!section) return null;

    let wrap = section.querySelector(
        "[data-aram-image-layout]"
    );

    if (wrap) return wrap;

    const imgs = Array.from(
        section.querySelectorAll("img")
    );

    if (!imgs.length) return null;

    const first = imgs[0];

    wrap = doc().createElement("div");

    wrap.className = "aram-image-layout";

    wrap.dataset.aramImageLayout = "true";

    first.before(wrap);

    imgs.forEach(img => {

        const figure = doc().createElement("figure");

        const caption =
            img.nextElementSibling?.classList.contains(
                "aram-image-caption"
            )
                ? img.nextElementSibling
                : null;

        figure.append(img);

        if (caption) {
            figure.append(caption);
        }

        wrap.append(figure);

    });

    return wrap;

}


/* APPLY IMAGE ARRANGEMENT */

function applyImageArrangement() {

    if (!selectedSection) return;

    const wrap =
        getImageLayoutContainer(selectedSection);

    if (!wrap) return;

    const layout =
        $("imageArrangement").value;

    const gap =
        Math.max(0,Number($("imageGap").value) || 18);

    const cols =
        Math.max(
            1,
            Math.min(6,Number($("imageColumns").value) || 3)
        );

    wrap.dataset.layout = layout;

    wrap.style.gap = gap + "px";

    wrap.style.setProperty(
        "--aram-columns",
        String(cols)
    );

    wrap.style.display =
        layout.startsWith("grid") || layout === "masonry"
            ? "grid"
            : "flex";

    wrap.style.flexDirection = ({
        row: "row",
        column: "column",
        "row-reverse": "row-reverse",
        "column-reverse": "column-reverse"
    })[layout] || "row";

    if (layout === "masonry") {

        wrap.style.display = "block";

        wrap.style.columns = String(cols);

    } else {

        wrap.style.removeProperty("columns");

    }

    if (layout.startsWith("grid")) {

        wrap.style.gridTemplateColumns =
            `repeat(${
                layout === "grid-2"
                    ? 2
                    : layout === "grid-3"
                        ? 3
                        : cols
            },minmax(0,1fr))`;

    } else {

        wrap.style.removeProperty("grid-template-columns");

    }

    if (layout === "wrap") {

        wrap.style.flexWrap = "wrap";

    } else {

        wrap.style.flexWrap = "nowrap";

    }

    recordHistory();

}


/* SELECT IMAGE */

function selectImageByIndex(value) {

    const img = imagesCache[Number(value)];

    if (!img) return;

    selectedImage = img;

    selectedText = null;

    clearSelection();

    selectedSection?.classList.add("aram-selected-section");

    img.classList.add("aram-selected-element");

    $("imageCaptionInput").value =
        img.parentElement?.querySelector(
            ".aram-image-caption"
        )?.textContent || "";

    $("imageWidth").value =
        img.style.width || "100%";

    $("imageStyle").value =
        img.style.borderRadius || "0";

    $("imageHeight").value =
        parseInt(img.style.height) || 260;

    $("imageFit").value =
        img.style.objectFit || "cover";

    $("imageOpacity").value =
        img.style.opacity || 1;

    $("imageShadow").value =
        img.style.boxShadow ? "yes" : "no";

    $("imageBorder").value =
        img.style.border || "none";

}


/* IMAGE UPLOAD */

function readImage(file) {

    if (!file || !file.type.startsWith("image/")) {

        return Promise.reject(
            new Error("Choose a valid image.")
        );

    }

    if (file.size > 5 * 1024 * 1024) {

        return Promise.reject(
            new Error("Image must be smaller than 5 MB.")
        );

    }

    return new Promise((resolve,reject) => {

        const r = new FileReader();

        r.onload = () => resolve(r.result);

        r.onerror = () =>
            reject(new Error("Image reading failed."));

        r.readAsDataURL(file);

    });

}


/* BACKEND API */

async function postFlyer(endpoint,formData) {

    let response;

    try {

        response = await fetch(
            API_BASE_URL + endpoint,
            {
                method: "POST",
                body: formData
            }
        );

    } catch {

        return Promise.reject(
            new Error(
                "Cannot connect to backend. Start your Node.js server at localhost:5000."
            )
        );

    }

    const body = await response.text();

    let result;

    try {

        result = JSON.parse(body);

    } catch {

        throw new Error(
            "Backend returned a non-JSON response: " +
            body.slice(0,160)
        );

    }

    if (!response.ok || result.success === false) {

        throw new Error(
            result.message ||
            result.error ||
            "Request failed (" + response.status + ")."
        );

    }

    return result;

}


/* FLYER VALIDATION */

function validateFlyer(file) {

    if (!file) {
        throw new Error("Choose an event flyer.");
    }

    const ext =
        file.name.split(".").pop().toLowerCase();

    if (
        !["jpg","jpeg","png","webp","pdf"].includes(ext)
    ) {
        throw new Error(
            "Upload JPG, PNG, WEBP or PDF."
        );
    }

    if (file.size > 10 * 1024 * 1024) {

        throw new Error(
            "Flyer must be smaller than 10 MB."
        );

    }

}


/* BUTTON LOADING */

function setBusy(button,busy,label) {

    button.disabled = busy;

    button.dataset.label ??= button.textContent;

    button.textContent =
        busy ? label : button.dataset.label;

}


/* DOWNLOAD HELPER */

function downloadBlob(blob,name) {

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;

    a.download = name;

    document.body.append(a);

    a.click();

    a.remove();

    setTimeout(
        () => URL.revokeObjectURL(url),
        5000
    );

}


/* STANDALONE HTML DOWNLOAD */

async function standaloneHTML() {

    const html = currentHTML();

    if (!html) {
        throw new Error("Website preview is not ready.");
    }

    const parsed = new DOMParser().parseFromString(
        addBase(html),
        "text/html"
    );

    parsed.querySelector("base")?.remove();

    const stylesheetLinks = [
        ...parsed.querySelectorAll(
            'link[rel="stylesheet"][href]'
        )
    ];

    for (const link of stylesheetLinks) {

        try {

            const u = new URL(
                link.getAttribute("href"),
                currentTemplateURL || location.href
            );

            if (u.origin !== location.origin) continue;

            const r = await fetch(u);

            if (!r.ok) continue;

            const style = parsed.createElement("style");

            style.textContent = await r.text();

            link.replaceWith(style);

        } catch(e) {

            console.warn("Stylesheet not embedded",e);

        }

    }

    for (const img of [
        ...parsed.querySelectorAll("img[src]")
    ]) {

        const src = img.getAttribute("src");

        if (
            !src ||
            /^(data:|blob:|https?:)/i.test(src)
        ) continue;

        try {

            const u = new URL(
                src,
                currentTemplateURL || location.href
            );

            if (u.origin !== location.origin) continue;

            const r = await fetch(u);

            if (!r.ok) continue;

            const blob = await r.blob();

            img.src = await new Promise(
                (resolve,reject) => {

                    const fr = new FileReader();

                    fr.onload = () => resolve(fr.result);

                    fr.onerror = reject;

                    fr.readAsDataURL(blob);

                }
            );

        } catch(e) {

            console.warn("Image not embedded",src,e);

        }

    }

    return "<!DOCTYPE html>\n" +
        parsed.documentElement.outerHTML;

}


/* EVENT WIRING */


/* ADD SECTION BUTTONS */

document.querySelectorAll("[data-type]").forEach(b => {

    b.addEventListener("click",() =>
        createSection(b.dataset.type)
    );

});


/* REFRESH SECTIONS */

$("refreshSectionsBtn").addEventListener(
    "click",
    () => {

        discoverSections();

        status("Section list refreshed.");

    }
);


/* SECTION NAME */

$("sectionNameInput").addEventListener(
    "change",
    () => {

        if (!selectedSection) return;

        selectedSection.dataset.aramName =
            $("sectionNameInput").value.trim() ||
            "New Section";

        renderSections();

        recordHistory();

    }
);


/* SECTION BACKGROUND */

$("sectionBackground").addEventListener(
    "input",
    () => {

        if (selectedSection) {

            selectedSection.style.backgroundColor =
                $("sectionBackground").value;

            recordHistory();

        }

    }
);


/* SECTION TEXT COLOR */

$("sectionTextColor").addEventListener(
    "input",
    () => {

        if (selectedSection) {

            selectedSection.style.color =
                $("sectionTextColor").value;

            recordHistory();

        }

    }
);


/* SECTION PADDING */

$("sectionPadding").addEventListener(
    "input",
    () => {

        if (selectedSection) {

            const v = Number(
                $("sectionPadding").value
            );

            selectedSection.style.padding =
                v + "px 7%";

            $("paddingValue").textContent =
                v + " px";

            recordHistory();

        }

    }
);


/* SECTION ALIGNMENT */

$("sectionAlignment").addEventListener(
    "change",
    () => {

        if (selectedSection) {

            selectedSection.style.textAlign =
                $("sectionAlignment").value;

            recordHistory();

        }

    }
);


/* SECTION LAYOUT */

$("sectionLayout").addEventListener(
    "change",
    () => {

        if (!selectedSection) return;

        const s = selectedSection;

        const v = $("sectionLayout").value;

        s.dataset.aramLayout = v;

        s.classList.remove(
            "aram-two-column",
            "aram-masonry"
        );

        s.style.removeProperty("display");

        s.style.removeProperty("grid-template-columns");

        s.style.removeProperty("gap");

        if (v === "two-column") {

            s.classList.add("aram-two-column");

        }

        if (v === "masonry") {

            s.classList.add("aram-masonry");

        }

        if (v === "grid") {

            s.style.display = "grid";

            s.style.gridTemplateColumns =
                "repeat(3,minmax(0,1fr))";

            s.style.gap = "20px";

        }

        if (v === "full") {

            s.style.width = "100%";

            s.style.maxWidth = "none";

        }

        recordHistory();

    }
);


/* DELETE SECTION */

$("deleteSectionBtn").addEventListener(
    "click",
    () => {

        if (!selectedSection) {
            return status("Select a section first.");
        }

        if (!confirm("Delete this section?")) return;

        selectedSection.remove();

        selectedSection = null;

        discoverSections();

        recordHistory();

        status("Section deleted.");

    }
);


/* DUPLICATE SECTION */

$("duplicateSectionBtn").addEventListener(
    "click",
    () => {

        if (!selectedSection) {
            return status("Select a section first.");
        }

        const copy = selectedSection.cloneNode(true);

        copy.classList.remove(
            "aram-selected-section",
            "aram-selected-element"
        );

        copy.dataset.aramName =
            (selectedSection.dataset.aramName || "Section") +
            " Copy";

        selectedSection.after(copy);

        discoverSections();

        selectSection(copy);

        recordHistory();

    }
);


/* HIDE / SHOW SECTION */

$("toggleSectionBtn").addEventListener(
    "click",
    () => {

        if (!selectedSection) {
            return status("Select a section first.");
        }

        const hide =
            selectedSection.dataset.aramHidden !== "true";

        selectedSection.dataset.aramHidden =
            String(hide);

        selectedSection.style.display =
            hide ? "none" : "";

        renderSections();

        recordHistory();

        status(
            hide ? "Section hidden." : "Section shown."
        );

    }
);


/* TEXT SELECTION */

$("textElementSelect").addEventListener(
    "change",
    e => selectTextByIndex(e.target.value)
);


/* APPLY TEXT */

$("applyTextBtn").addEventListener(
    "click",
    () => {

        if (!selectedText) {
            return status("Select a text element first.");
        }

        selectedText.textContent =
            $("textContentInput").value;

        selectedText.style.fontSize =
            Math.max(
                8,
                Math.min(
                    120,
                    Number($("fontSizeInput").value) || 16
                )
            ) + "px";

        selectedText.style.fontWeight =
            $("fontWeightInput").value;

        selectedText.style.textAlign =
            $("textAlignment").value;

        refreshElementLists();

        recordHistory();

        status("Text updated.");

    }
);


/* ADD TEXT */

$("addTextBtn").addEventListener(
    "click",
    () => {

        if (!selectedSection) {
            return status("Select a section first.");
        }

        const p = doc().createElement("p");

        p.textContent = "New text content";

        selectedSection.append(p);

        refreshElementLists();

        const i = textNodesCache.indexOf(p);

        $("textElementSelect").value = String(i);

        selectTextByIndex(String(i));

        recordHistory();

    }
);


/* DELETE TEXT */

$("deleteTextBtn").addEventListener(
    "click",
    () => {

        if (!selectedText) {
            return status("Select a text element first.");
        }

        selectedText.remove();

        selectedText = null;

        refreshElementLists();

        recordHistory();

        status("Text deleted.");

    }
);


/* IMAGE SELECTION */

$("imageElementSelect").addEventListener(
    "change",
    e => selectImageByIndex(e.target.value)
);


/* IMAGE REPLACEMENT */

$("imageUploadInput").addEventListener(
    "change",
    async e => {

        if (!selectedImage) {

            status("Select an image before uploading a replacement.");

            e.target.value = "";

            return;

        }

        const f = e.target.files[0];

        if (!f) return;

        try {

            selectedImage.src = await readImage(f);

            applyImageProperties();

            recordHistory();

            status("Image replaced.");

        } catch(err) {

            status(err.message);

        } finally {

            e.target.value = "";

        }

    }
);


/* APPLY IMAGE PROPERTIES */

function applyImageProperties() {

    if (!selectedImage) return;

    selectedImage.style.width =
        $("imageWidth").value;

    selectedImage.style.maxWidth = "100%";

    selectedImage.style.height =
        Math.max(
            40,
            Math.min(
                900,
                Number($("imageHeight").value) || 260
            )
        ) + "px";

    selectedImage.style.objectFit =
        $("imageFit").value;

    selectedImage.style.borderRadius =
        $("imageStyle").value;

    selectedImage.style.opacity =
        String(
            Math.max(
                0.1,
                Math.min(
                    1,
                    Number($("imageOpacity").value) || 1
                )
            )
        );

    selectedImage.style.boxShadow =
        $("imageShadow").value === "yes"
            ? "0 10px 28px rgba(0,0,0,.18)"
            : "none";

    selectedImage.style.border =
        $("imageBorder").value;

    let cap =
        selectedImage.parentElement?.querySelector(
            ".aram-image-caption"
        );

    const value =
        $("imageCaptionInput").value.trim();

    if (value) {

        if (!cap) {

            cap = doc().createElement("p");

            cap.className = "aram-image-caption";

            selectedImage.after(cap);

        }

        cap.textContent = value;

    } else {

        cap?.remove();

    }

}


/* APPLY IMAGE BUTTON */

$("applyImageBtn").addEventListener(
    "click",
    () => {

        if (!selectedImage) {
            return status("Select an image first.");
        }

        applyImageProperties();

        recordHistory();

        status("Image settings applied.");

    }
);


/* IMAGE PROPERTY CHANGE */

[
    "imageCaptionInput",
    "imageWidth",
    "imageStyle",
    "imageHeight",
    "imageFit",
    "imageOpacity",
    "imageShadow",
    "imageBorder"
].forEach(id => {

    $(id).addEventListener(
        "change",
        () => {

            applyImageProperties();

            recordHistory();

        }
    );

});


/* DELETE IMAGE */

$("deleteImageBtn").addEventListener(
    "click",
    () => {

        if (!selectedImage) {
            return status("Select an image first.");
        }

        const cap =
            selectedImage.parentElement?.querySelector(
                ".aram-image-caption"
            );

        selectedImage.remove();

        cap?.remove();

        selectedImage = null;

        refreshElementLists();

        recordHistory();

    }
);


/* IMAGE LAYOUT EVENTS */

[
    "imageArrangement",
    "imageGap",
    "imageColumns"
].forEach(id => {

    $(id).addEventListener(
        "change",
        applyImageArrangement
    );

});


/* ADD IMAGE */

$("addImageBtn").addEventListener(
    "click",
    () => {

        if (!selectedSection) {
            return status("Select a section first.");
        }

        const img = makeImg(doc());

        selectedSection.append(img);

        getImageLayoutContainer(selectedSection);

        refreshElementLists();

        const i = imagesCache.indexOf(img);

        $("imageElementSelect").value = String(i);

        selectImageByIndex(String(i));

        recordHistory();

        status("Image added. Upload a replacement image.");

    }
);


/* CLICK ELEMENTS INSIDE PREVIEW */

function installSelection() {

    const d = doc();

    if (!d?.body || d.body.dataset.aramInstalled === "true") {
        return;
    }

    d.body.dataset.aramInstalled = "true";

    d.addEventListener("click", e => {

        const target = e.target;

        if (!(target instanceof d.defaultView.Element)) {
            return;
        }

        const section = sections.find(
            s => s === target || s.contains(target)
        );

        if (!section) return;

        if (selectedSection !== section) {
            selectSection(section);
        }

        if (target.tagName === "IMG") {

            refreshElementLists();

            const i = imagesCache.indexOf(target);

            $("imageElementSelect").value = String(i);

            selectImageByIndex(String(i));

            return;

        }

        const text = target.closest(TEXT_SELECTOR);

        if (text && selectedSection.contains(text)) {

            refreshElementLists();

            const i = textNodesCache.indexOf(text);

            $("textElementSelect").value = String(i);

            selectTextByIndex(String(i));

        }

    });

}


/* SAVE DRAFT */

$("saveBtn").addEventListener(
    "click",
    () => {

        const html = currentHTML();

        if (!html) return;

        try {

            localStorage.setItem(DRAFT_KEY,html);

            status("Draft saved successfully.");

        } catch {

            status(
                "Browser storage is full. Use smaller images or download your website."
            );

        }

    }
);


/* RESTORE TEMPLATE */

$("restoreBtn").addEventListener(
    "click",
    () => {

        if (!confirm("Restore the original template? Saved edits will be lost.")) {
            return;
        }

        localStorage.removeItem(DRAFT_KEY);

        selectedSection = null;
        selectedText = null;
        selectedImage = null;

        loadTemplate();

        status("Restoring template...");

    }
);


/* UNDO */

$("undoBtn").addEventListener(
    "click",
    () => restoreHistory(historyIndex-1)
);


/* REDO */

$("redoBtn").addEventListener(
    "click",
    () => restoreHistory(historyIndex+1)
);


/* PREVIEW */

$("previewBtn").addEventListener(
    "click",
    () => {

        const html = currentHTML();

        if (!html) return;

        const url = URL.createObjectURL(
            new Blob(
                [addBase(html)],
                {type:"text/html"}
            )
        );

        const w = window.open(url,"_blank");

        if (!w) {

            URL.revokeObjectURL(url);

            status("Allow popups to open preview.");

        } else {

            setTimeout(
                () => URL.revokeObjectURL(url),
                60000
            );

        }

    }
);


/* RESPONSIVE PREVIEW BUTTONS */

document.querySelectorAll("[data-size]").forEach(b => {

    b.addEventListener("click",() => {

        iframe.style.width = b.dataset.size;

        iframe.style.maxWidth = "100%";

        iframe.style.margin = "0 auto";

    });

});


/* DOWNLOAD WEBSITE */

$("downloadBtn").addEventListener(
    "click",
    async () => {

        const b = $("downloadBtn");

        setBusy(b,true,"Preparing...");

        try {

            downloadBlob(
                new Blob(
                    [await standaloneHTML()],
                    {type:"text/html;charset=utf-8"}
                ),
                "aram-events-website.html"
            );

            status("Website downloaded.");

        } catch(e) {

            status("Download failed: " + e.message);

        } finally {

            setBusy(b,false);

        }

    }
);


/* FLYER UPLOAD AND PREVIEW */

$("flyerInput").addEventListener(
    "change",
    async e => {

        const file = e.target.files[0];

        if (!file) return;

        try {

            validateFlyer(file);

            if (flyerObjectURL) {
                URL.revokeObjectURL(flyerObjectURL);
            }

            if (
                file.type.startsWith("image/") ||
                /\.(jpg|jpeg|png|webp)$/i.test(file.name)
            ) {

                flyerDataURL = await readImage(file);

                $("flyerPreview").src = flyerDataURL;

                $("flyerPreview").style.display = "block";

                $("flyerPdfPreview").style.display = "none";

            } else {

                flyerDataURL = "";

                flyerObjectURL = URL.createObjectURL(file);

                $("flyerPdfPreview").src = flyerObjectURL;

                $("flyerPdfPreview").style.display = "block";

                $("flyerPreview").style.display = "none";

            }

            flyerStatus("Flyer uploaded successfully.");

        } catch(err) {

            flyerStatus(err.message);

            e.target.value = "";

        }

    }
);


/* EXTRACT FLYER DETAILS */

$("extractFlyerBtn").addEventListener(
    "click",
    async () => {

        const b = $("extractFlyerBtn");

        try {

            const file = $("flyerInput").files[0];

            validateFlyer(file);

            const fd = new FormData();

            fd.append("flyer",file);

            setBusy(b,true,"Extracting...");

            flyerStatus("Extracting event information...");

            const result = await postFlyer(
                "/api/extract-flyer",
                fd
            );

            const data =
                result.data || result.result || {};

            $("flyerEventName").value =
                data.eventName || data.event_name || "";

            $("flyerDate").value =
                data.eventDate ||
                data.event_date ||
                data.date || "";

            $("flyerTime").value =
                data.eventTime ||
                data.event_time ||
                data.time || "";

            $("flyerVenue").value =
                data.venue || data.location || "";

            $("flyerDescription").value =
                data.description || "";

            flyerStatus("Flyer details extracted.");

        } catch(err) {

            flyerStatus(err.message);

        } finally {

            setBusy(b,false);

        }

    }
);


/* GENERATE EVENT WEBSITE */

$("generateWebsiteBtn").addEventListener(
    "click",
    async () => {

        const b = $("generateWebsiteBtn");

        const file = $("flyerInput").files[0];

        const name =
            $("flyerEventName").value.trim();

        const date =
            $("flyerDate").value.trim();

        const time =
            $("flyerTime").value.trim();

        const venue =
            $("flyerVenue").value.trim();

        const description =
            $("flyerDescription").value.trim();

        if (
            !file &&
            !name &&
            !date &&
            !venue &&
            !description
        ) {

            return flyerStatus(
                "Upload a flyer or enter event details."
            );

        }

        try {

            if (file) validateFlyer(file);

            setBusy(b,true,"Generating...");

            flyerStatus(
                "AI is generating your event website..."
            );

            const fd = new FormData();

            if (file) {
                fd.append("flyer",file);
            }

            fd.append("eventName",name);
            fd.append("eventDate",date);
            fd.append("eventTime",time);
            fd.append("venue",venue);
            fd.append("description",description);

            fd.append(
                "design",
                "Create a complete professional responsive event website with navigation, premium hero, overview, schedule, speakers and partners only if provided, venue, contact and gallery. Do not invent confirmed details. Return complete HTML."
            );

            const result = await postFlyer(
                "/api/generate-website",
                fd
            );

            const html =
                result.html ||
                result.data?.html ||
                result.data?.websiteHTML ||
                result.websiteHTML;

            if (!html || !/<html[\s>]/i.test(html)) {

                throw new Error(
                    "AI did not return complete HTML. Check the backend response."
                );

            }

            selectedSection = null;
            selectedText = null;
            selectedImage = null;

            historyStack = [];
            historyIndex = -1;

            iframe.srcdoc = addBase(html);

            flyerStatus(
                "Website generated. Loading preview..."
            );

        } catch(err) {

            console.error(err);

            flyerStatus(err.message);

        } finally {

            setBusy(b,false);

        }

    }
);


/* PUBLISH WEBSITE TO LOCAL SERVER */

const publishButton = $("publishBtn");
if (publishButton) {
    publishButton.addEventListener("click", async () => {
        const html = currentHTML();
        if (!html) return status("There is no website HTML to publish.");
        const suggested = (document.title || "aram-website").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const slug = (prompt("Choose a local website address:", suggested || "my-website") || "").trim();
        if (!slug) return;
        publishButton.disabled = true;
        status("Publishing to your local server...");
        try {
            const response = await fetch("/api/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, html }) });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || "Publish failed.");
            status("Published locally: " + location.origin + result.url);
            window.open(result.url, "_blank", "noopener");
        } catch (error) { status(error.message); }
        finally { publishButton.disabled = false; }
    });
}


/* IFRAME LOAD */

iframe.addEventListener(
    "load",
    () => {

        try {

            installStyles();

            discoverSections();

            installSelection();

            if (!restoring) {

                const html = currentHTML();

                if (
                    html &&
                    historyStack[historyStack.length-1] !== html
                ) {

                    historyStack =
                        historyStack.slice(0,historyIndex+1);

                    historyStack.push(html);

                    historyIndex = historyStack.length-1;

                }

            }

            status(
                "Website loaded. Click a section, text or image to edit."
            );

        } catch(e) {

            console.error(e);

            status(
                "Could not initialize editor: " + e.message
            );

        }

    }
);


/* GLOBAL EDITOR API */

window.AramEditor = {

    save: () => $("saveBtn").click(),

    download: () => $("downloadBtn").click(),

    refresh: discoverSections,

    addSection: createSection,

    getHTML: currentHTML

};


/* CLEANUP */

window.addEventListener(
    "beforeunload",
    () => {

        if (flyerObjectURL) {
            URL.revokeObjectURL(flyerObjectURL);
        }

    }
);


/* START EDITOR */

loadTemplate();

})();
