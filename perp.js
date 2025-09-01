// A Node.js script to analyze a Shopify store using the Perplexity Sonar API.

// --- Configuration ---
// IMPORTANT: Replace with your actual Perplexity API key.
const PERPLEXITY_API_KEY = "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";

// IMPORTANT: Replace with the target Shopify store URL.
const shopifyUrl = "nala.ro";


// --- Main Function ---
async function analyzeShopifyStore(url) {
  if (PERPLEXITY_API_KEY === "YOUR_PERPLEXITY_API_KEY" || !PERPLEXITY_API_KEY) {
    console.error("❌ Error: Please replace 'YOUR_PERPLEXITY_API_KEY' with your actual Perplexity API key.");
    return;
  }

  // This prompt is specifically engineered to ask the model to perform the analysis
  // and return *only* a valid JSON object in its response.
  const prompt = `
    Analyze the website at the URL: ${url}.
    From its content, determine the following four details:
    1. The store's default currency (as a 3-letter ISO code, e.g., "USD").
    2. A brief brand profile (maximum 100 words).
    3. The store's base country (e.g., "United States").
    4. The store's default language (as a 2-letter ISO code, e.g., "en").
    5. The top 5 major festivals in that country, along with their dates. 

    Return your findings ONLY as a single, valid JSON object with no additional text, explanation, or markdown formatting. The JSON object must use these exact keys: "default_currency", "store_description", "base_country", "default_language", "top_festivals".
  `;

  console.log(`🚀 Sending analysis request for: ${url}`);

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: "sonar", // Using an online model is crucial for accessing the URL
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    
    // The model's response is a string inside the 'content' field.
    // We need to parse this string to get the final JSON object.
    const contentString = data.choices[0].message.content;
    
    console.log("✅ Received raw content from API. Attempting to parse...");
    
    const storeInfo = JSON.parse(contentString);

    console.log("\n--- Store Analysis Complete ---");
    console.log(JSON.stringify(storeInfo, null, 2));
    console.log("-----------------------------\n");
    
    return storeInfo;

  } catch (error) {
    console.error("❌ An error occurred during the process:");
    console.error(error);
  }
}

// --- Execute the Script ---
analyzeShopifyStore(shopifyUrl);