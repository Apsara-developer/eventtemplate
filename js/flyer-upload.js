
/* =========================================
   ARAM EVENTS - FLYER OCR
   Tesseract.js + PDF.js
========================================= */

const flyerInput = document.getElementById("flyerInput");
const extractFlyerBtn = document.getElementById("extractFlyerBtn");
const flyerFileName = document.getElementById("flyerFileName");
const flyerStatus = document.getElementById("flyerStatus");
const flyerResults = document.getElementById("flyerResults");
const flyerRawText = document.getElementById("flyerRawText");

let extractedFlyerText = "";

/* STATUS */

function flyerMessage(message, type = "") {
    flyerStatus.textContent = message;
    flyerStatus.className = "flyer-status " + type;
}

/* FILE SELECTION */

flyerInput.addEventListener("change", () => {
    const file = flyerInput.files[0];

    flyerResults.hidden = true;

    if (!file) {
        flyerFileName.textContent = "No flyer selected";
        return;
    }

    flyerFileName.textContent = file.name;
    flyerMessage("");
});

/* IMAGE OCR */

async function extractImageText(file) {

    const result = await Tesseract.recognize(
        file,
        "eng",
        {
            logger: message => {
                if (message.status === "recognizing text") {
                    const progress = Math.round(
                        message.progress * 100
                    );

                    flyerMessage(
                        "Reading flyer: " + progress + "%"
                    );
                }
            }
        }
    );

    return result.data.text;
}

/* PDF OCR */

async function extractPDFText(file) {

    const buffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(buffer)
    }).promise;

    let completeText = "";

    for (let pageNumber = 1;
         pageNumber <= pdf.numPages;
         pageNumber++) {

        flyerMessage(
            `Processing PDF page ${pageNumber} of ${pdf.numPages}`
        );

        const page = await pdf.getPage(pageNumber);

        const viewport = page.getViewport({
            scale: 2
        });

        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        const result = await Tesseract.recognize(
            canvas,
            "eng"
        );

        completeText += "\n" + result.data.text;
    }

    return completeText;
}

/* EXTRACT BUTTON */

extractFlyerBtn.addEventListener("click", async () => {

    const file = flyerInput.files[0];

    if (!file) {
        flyerMessage("Please upload an event flyer.", "error");
        return;
    }

    const validTypes = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "application/pdf"
    ];

    if (!validTypes.includes(file.type)) {
        flyerMessage("Unsupported file format.", "error");
        return;
    }

    if (file.size > 15 * 1024 * 1024) {
        flyerMessage("File size must be below 15 MB.", "error");
        return;
    }

    extractFlyerBtn.disabled = true;
    extractFlyerBtn.textContent = "Extracting...";

    try {

        if (file.type === "application/pdf") {
            extractedFlyerText = await extractPDFText(file);
        } else {
            extractedFlyerText = await extractImageText(file);
        }

        if (!extractedFlyerText.trim()) {
            throw new Error("No readable text found.");
        }

        flyerRawText.textContent = extractedFlyerText;

        fillFlyerFields(extractedFlyerText);

        flyerResults.hidden = false;

        flyerMessage(
            "Flyer details extracted. Please verify them.",
            "success"
        );

    } catch (error) {

        console.error(error);

        flyerMessage(
            "Extraction failed: " + error.message,
            "error"
        );

    } finally {

        extractFlyerBtn.disabled = false;
        extractFlyerBtn.textContent = "Extract Event Details";

    }

});

/* TEXT EXTRACTION HELPERS */

function extractLine(lines, patterns) {

    for (const line of lines) {

        for (const pattern of patterns) {

            const match = line.match(pattern);

            if (match && match[1]) {
                return match[1].trim();
            }
        }
    }

    return "";
}

/* FILL FORM FIELDS */

function fillFlyerFields(text) {

    const lines = text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

    const emailMatch = text.match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
    );

    const phoneMatch = text.match(
        /(?:\+?\d[\d\s().-]{7,}\d)/
    );

    const dateMatch = text.match(
        /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i
    );

    const timeMatch = text.match(
        /\b\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)\b/
    );

    const venue = extractLine(lines, [
        /^(?:venue|location|address)\s*[:\-]\s*(.+)$/i
    ]);

    const speaker = extractLine(lines, [
        /^(?:speaker|chief guest|guest speaker|chief guest name)\s*[:\-]\s*(.+)$/i
    ]);

    const organizer = extractLine(lines, [
        /^(?:organizer|organised by|organized by|hosted by)\s*[:\-]\s*(.+)$/i
    ]);

    const eventName = lines.find(line =>
        line.length > 3 &&
        line.length < 100 &&
        !/^(date|time|venue|location|email|phone|contact|organizer|organized by|organised by)\s*:/i.test(line)
    ) || "";

    document.getElementById("flyerEventName").value =
        eventName;

    document.getElementById("flyerDate").value =
        dateMatch ? dateMatch[0] : "";

    document.getElementById("flyerTime").value =
        timeMatch ? timeMatch[0] : "";

    document.getElementById("flyerVenue").value =
        venue;

    document.getElementById("flyerSpeaker").value =
        speaker;

    document.getElementById("flyerOrganizer").value =
        organizer;

    document.getElementById("flyerEmail").value =
        emailMatch ? emailMatch[0] : "";

    document.getElementById("flyerPhone").value =
        phoneMatch ? phoneMatch[0].trim() : "";
}

/* GENERATE WEBSITE */

document.getElementById("useFlyerDetails")
    .addEventListener("click", generateWebsiteFromFlyer);

function generateWebsiteFromFlyer() {

    const details = {
        eventName: document.getElementById("flyerEventName").value.trim(),
        date: document.getElementById("flyerDate").value.trim(),
        time: document.getElementById("flyerTime").value.trim(),
        venue: document.getElementById("flyerVenue").value.trim(),
        speaker: document.getElementById("flyerSpeaker").value.trim(),
        organizer: document.getElementById("flyerOrganizer").value.trim(),
        email: document.getElementById("flyerEmail").value.trim(),
        phone: document.getElementById("flyerPhone").value.trim()
    };

    if (!details.eventName) {
        flyerMessage("Please enter the event name.", "error");
        return;
    }

    const iframe = document.getElementById("websitePreview");
    const doc = iframe.contentDocument;

    if (!doc || !doc.body) {
        flyerMessage("Please open a website template first.", "error");
        return;
    }

    let main = doc.querySelector("main");

    if (!main) {
        main = doc.createElement("main");
        doc.body.appendChild(main);
    }

    /* Remove previously generated flyer section */

    const oldSection = doc.getElementById("flyer-generated-section");

    if (oldSection) {
        oldSection.remove();
    }

    /* Create event website section */

    const section = doc.createElement("section");

    section.id = "flyer-generated-section";
    section.setAttribute("data-editor-name", "Flyer Event Details");

    section.style.cssText = `
        padding: 65px 25px;
        text-align: center;
        background: #f4f3ff;
        color: #222;
        font-family: Arial, sans-serif;
    `;

    const heading = doc.createElement("h1");
    heading.textContent = details.eventName;

    heading.style.cssText = `
        font-size: clamp(28px, 5vw, 48px);
        margin-bottom: 25px;
    `;

    section.appendChild(heading);

    const items = [
        ["Date", details.date],
        ["Time", details.time],
        ["Venue", details.venue],
        ["Speaker / Chief Guest", details.speaker],
        ["Organizer", details.organizer],
        ["Email", details.email],
        ["Contact", details.phone]
    ];

    items.forEach(([label, value]) => {

        if (!value) return;

        const paragraph = doc.createElement("p");

        const strong = doc.createElement("strong");
        strong.textContent = label + ": ";

        paragraph.appendChild(strong);
        paragraph.appendChild(doc.createTextNode(value));

        paragraph.style.cssText = `
            margin: 12px auto;
            font-size: 17px;
            line-height: 1.6;
        `;

        section.appendChild(paragraph);
    });

    main.appendChild(section);

    /* Refresh existing editor functions if available */

    if (typeof window.discoverSections === "function") {
        window.discoverSections();
    }

    if (typeof window.saveWebsiteQuiet === "function") {
        window.saveWebsiteQuiet();
    }

    flyerMessage(
        "Event details added to your website. You can continue editing the section.",
        "success"
    );
}
