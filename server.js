// --- server.js ---

// Import necessary libraries
import express from 'express';
import fetch from 'node-fetch';


// --- Configuration ---
// IMPORTANT: Replace with your actual API keys.
const PERPLEXITY_API_KEY = ""; // 👈 PASTE YOUR PERPLEXITY KEY HERE
const GEMINI_API_KEY = "AIzaSyCvl6HPx71KVoO1PRWuCvAyHF83VX6gLWE";       // 👈 PASTE YOUR GEMINI KEY HERE

// Initialize the Express server
const app = express();
const port = 3000;

// Middleware to serve the HTML file and parse JSON requests
app.use(express.static('.'));
app.use(express.json());

// --- Function to get store analysis from Perplexity ---
async function analyzeShopifyStore(url) {
  // ... (This function remains unchanged from the previous version)
  if (!PERPLEXITY_API_KEY || PERPLEXITY_API_KEY === "YOUR_PERPLEXITY_API_KEY") {
    throw new Error("Perplexity API key is not configured.");
  }
  const prompt = `
    Analyze the website at the URL: ${url}.
    From its content, determine the following details:
    1. The store's default currency (as a 3-letter ISO code).
    2. A brief brand profile or store description (maximum 100 words).
    3. The store's base country.
    4. The store's default language (as a 2-letter ISO code).
    5. The top 5 major festivals in that country, along with their dates.
    Return your findings ONLY as a single, valid JSON object with no additional text, explanation, or markdown formatting. The JSON object must use these exact keys: "default_currency", "store_description", "base_country", "default_language", "top_festivals".
  `;
  console.log(`🚀 Sending analysis request to Perplexity for: ${url}`);
  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${PERPLEXITY_API_KEY}` },
    body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: prompt }] }),
  });
  if (!response.ok) { throw new Error(`Perplexity API request failed with status ${response.status}: ${await response.text()}`); }
  const data = await response.json();
  let contentString = data.choices[0].message.content;
  console.log("✅ Received raw content from Perplexity. Cleaning and parsing...");
  const startIndex = contentString.indexOf('{');
  const endIndex = contentString.lastIndexOf('}');
  if (startIndex !== -1 && endIndex !== -1) { contentString = contentString.slice(startIndex, endIndex + 1); } 
  else { throw new Error("Could not find a valid JSON object in the Perplexity response."); }
  return JSON.parse(contentString);
}

// --- Function to generate email templates using Gemini (NOW ACCEPTS A SPECIFIC FESTIVAL) ---
async function generateEmailTemplates(storeContext, specificFestivalName = null) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY") {
    throw new Error("Gemini API key is not configured.");
  }

  // Use the specific festival if provided, otherwise default to the first one.
  const festivalForPrompt = specificFestivalName || storeContext.top_festivals[0].name;
  console.log(`✍️ Generating email copy themed for: ${festivalForPrompt}`);
  
  const prompt = `
    You are an expert email marketing copywriter for e-commerce stores.
    Based on the following store profile, generate 6 short, compelling email templates.
    
    **Store Profile:**
    - **Description:** ${storeContext.store_description}
    - **Country:** ${storeContext.base_country}
    - **Currency:** ${storeContext.default_currency}
    - **Theme this campaign around the festival of:** ${festivalForPrompt}

    Generate a JSON object containing the 6 email templates. The keys must be exactly: "reminder", "abandoned", "price_drop", "back_in_stock", "low_stock", "campaign".
    For the "campaign" email, create a "Win Your Wishlist" campaign themed around the provided festival.
    The copy should reflect the brand's tone from the description. Do NOT include subject lines. Just provide the body copy.
    Return ONLY the valid JSON object, with no extra text or markdown.
  `;

  console.log("🚀 Sending request to Gemini to generate email templates...");
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
  
  const response = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!response.ok) { throw new Error(`Gemini API request failed with status ${response.status}: ${await response.text()}`); }
  const result = await response.json();
  const jsonText = result.candidates[0].content.parts[0].text;
  console.log("✅ Received email templates from Gemini.");
  return JSON.parse(jsonText);
}


// --- The Main API Endpoint (NOW HANDLES TWO CASES) ---
app.post('/simulate', async (req, res) => {
  const { storeUrl, context, targetFestival } = req.body;

  try {
    // CASE 1: Season-specific simulation (faster)
    if (context && targetFestival) {
      console.log(`\n--- New Season Simulation Request for: ${targetFestival} ---`);
      const emailTemplates = await generateEmailTemplates(context, targetFestival);
      res.json({ email_templates: emailTemplates });
    
    // CASE 2: Initial full simulation
    } else if (storeUrl) {
      console.log(`\n--- New Full Simulation Request for: ${storeUrl} ---`);
      const storeContext = await analyzeShopifyStore(storeUrl);
      const emailTemplates = await generateEmailTemplates(storeContext);
      const finalResponse = { ...storeContext, email_templates: emailTemplates };
      console.log("✅ Full simulation complete. Sending final data to frontend.");
      res.json(finalResponse);
    
    } else {
      throw new Error("Invalid request. Provide either storeUrl or context with targetFestival.");
    }

  } catch (error) {
    console.error("❌ An error occurred during the simulation process:", error);
    res.status(500).json({ error: 'Failed to process simulation. Check server logs.' });
  }
});


// --- Start the server ---
app.listen(port, () => {
  console.log(`\n✅ Server is running!`);
  console.log(`➡️ Open http://localhost:${port} in your browser to use the tool.`);
});
