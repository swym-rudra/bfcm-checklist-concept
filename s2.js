import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import fsSync from 'fs';
import axios from 'axios';
import sharp from 'sharp';
import path from 'path';
import puppeteer from 'puppeteer';
import PDFMerger from 'pdf-merger-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import 'dotenv/config'; // Loads .env file automatically
import { textContent } from './text-content.js';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });
const MAX_PRODUCTS = 5;

// Get CLI args
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('❌ Usage: node w1.js <storeUrl> <toEmail>');
  process.exit(1);
}
const inputUrl = args[0];
const TO_EMAIL = args[1];

function generateUrlsToTry(baseUrl) {
  const urls = [];
  
  // Normalize input: strip protocol, strip www., get domain
  const domain = baseUrl
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];

  const paths = [
    '/collections/new',
    '/collections/best-sellers',
    '/collections/all',
    '/collections/sale',
    '/products',
    '/shop',
    '/'
  ];

  for (const p of paths) {
    // Always try non-www version
    urls.push(`https://${domain}${p}`);

    // Only add www. version if domain is NOT *.myshopify.com
    if (!domain.endsWith('.myshopify.com')) {
      urls.push(`https://www.${domain}${p}`);
    }
  }

  // Remove duplicates (just in case)
  return [...new Set(urls)];
}


async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!res.ok) {
      // console.error(`❌ Failed to fetch ${url}: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`❌ Error fetching HTML from ${url}: ${err.message}`);
    return null;
  }
}

async function safeFetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!res.ok) {
      console.error(`❌ Failed to fetch ${url}: ${res.status} ${res.statusText}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      console.error(`❌ Unexpected Content-Type for ${url}: ${contentType}`);
      console.error(`❌ Response snippet:\n${text.substring(0, 200)}...`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.error(`❌ Error fetching JSON from ${url}: ${err.message}`);
    return null;
  }
}

async function scrapeProductUrls(baseUrl) {
  const urlsToTry = generateUrlsToTry(baseUrl);
  console.log(`🔍 Collection URLs to try:`, urlsToTry);

  const productUrls = [];
  let storeLanguage = 'Not found';

  for (const url of urlsToTry) {
    console.log(`🌐 Visiting: ${url}`);
    const html = await fetchHtml(url);
    if (!html) continue;
    
    const $ = cheerio.load(html);

    if (storeLanguage === 'Not found') {
      const lang = $('html').attr('lang');
      if (lang) {
        storeLanguage = lang;
      }
    }

    $('a[href*="/products/"]').each((_, el) => {
      const href = $(el).attr('href');
      const title = $(el).text().trim().toLowerCase();
      let surroundingText = title;
      if (!title) {
        surroundingText = $(el).closest('.frenzy_product_item').text().trim().toLowerCase();
      }

      if (href) {
        if (surroundingText.includes('gift') || surroundingText.includes('voucher') || surroundingText.includes('gift-card') || surroundingText.includes('gift-voucher')) {
          console.log(`🚫 Skipped (gift/voucher): ${href}`);
          return;
        }
        const fullUrl = href.startsWith('http') ? href : new URL(href, url).href;

        if (!productUrls.includes(fullUrl)) {
          productUrls.push(fullUrl);
          console.log(`✅ Added: ${fullUrl}`);
        }
      }

      if (productUrls.length >= MAX_PRODUCTS * 5) return false;
    });

    if (productUrls.length >= MAX_PRODUCTS * 5) break;
  }

  console.log(`\n✅ Total product URLs found: ${productUrls.length}`);
  return { productUrls, storeLanguage };
}

async function scrapeAboutText(baseUrl) {
  console.log('\n🔍 Scraping for brand language...');
  const potentialPaths = ['/pages/about', '/about', '/about-us', '/pages/our-story', '/our-story'];
  
  for (const path of potentialPaths) {
    const url = new URL(path, baseUrl).href;
    console.log(`🌐 Trying about page: ${url}`);
    const html = await fetchHtml(url);

    if (html) {
      const $ = cheerio.load(html);
      const text = $('p').text().trim().replace(/\s\s+/g, ' ');
      if (text.length > 50) {
        console.log(`✅ Found about text at: ${url}`);
        return text.substring(0, 500) + '...';
      }
    }
  }

  console.warn('⚠️ Could not find a dedicated about page with significant text.');
  const homeHtml = await fetchHtml(baseUrl);
  if (homeHtml) {
    const $ = cheerio.load(homeHtml);
    const homeText = $('p').text().trim().replace(/\s\s+/g, ' ');
    if (homeText.length > 50) {
      console.log('✅ Using fallback text from homepage.');
      return homeText.substring(0, 500) + '...';
    }
  }

  return 'No descriptive text found.';
}

// ✅ Updated: Generate both main + thumbnail
async function downloadAndCompressImage(imageUrl, productTitle) {
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data);

  const outputDir = path.resolve('./tmp');
  await fs.mkdir(outputDir, { recursive: true });

  // Main hero image
  const mainFilename = `${outputDir}/${productTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.jpg`;
  await sharp(buffer)
    .jpeg({ quality: 70 })
    .toFile(mainFilename);
  const b64Main = fsSync.readFileSync(mainFilename, 'base64');

  // Thumbnail version for POS grid
  const thumbFilename = `${outputDir}/${productTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_thumb.jpg`;
  await sharp(buffer)
    .resize({ width: 400 }) // smaller width
    .jpeg({ quality: 50 })
    .toFile(thumbFilename);
  const b64Thumb = fsSync.readFileSync(thumbFilename, 'base64');

  return {
    imageMain: `data:image/jpeg;base64,${b64Main}`,
    imageThumb: `data:image/jpeg;base64,${b64Thumb}`
  };
}

async function scrapeProductDetails(productUrl) {
  const jsonUrl = productUrl.endsWith('.json') ? productUrl : `${productUrl}.json`;
  console.log(`🔎 Scraping product JSON: ${jsonUrl}`);

  const json = await safeFetchJson(jsonUrl);
  if (!json || !json.product) {
    console.warn(`⚠️ Skipping product: ${productUrl} — Invalid or missing JSON.`);
    return null;
  }

  const title = json.product.title;
  const price = parseFloat(json.product.variants[0]?.price) || 0;
  const imageUrl = json.product.images[0]?.src;

  if (!title || price <= 0 || !imageUrl) {
    console.warn(`⚠️ Skipping product: ${productUrl} — Missing data or zero price.`);
    return null;
  }

  const { imageMain, imageThumb } = await downloadAndCompressImage(imageUrl, title);

  console.log(`📦 ${title} — $${price} — using compressed images`);

  return {
    title: title,
    price: price,
    newPrice: (price * 0.8).toFixed(2),
    imageLocalPath: imageMain,
    imageThumbPath: imageThumb,
    link: productUrl
  };
}

function getFromEmail(baseUrl) {
  const domain = baseUrl
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase();
  return `marketing@${domain}`;
}

function getSafeDomainName(baseUrl) {
  return baseUrl
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, '_');
}

function getReadableDomain(baseUrl) {
  return baseUrl
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase();
}

// import fs from 'fs/promises';
// import puppeteer from 'puppeteer';
// import PDFMerger from 'pdf-merger-js';

async function generateCombinedPDF(products, FROM_EMAIL, TO_EMAIL, domainName, readableDomain, translatedContent) {
  // 1. Read the static HTML template files that are always used
  const introHtml = await fs.readFile('./templates/intro-page.html', 'utf8');
  const posHtml = await fs.readFile('./templates/pos.html', 'utf8');
  const extroHtml = await fs.readFile('./templates/extro.html', 'utf8');

  // 2. Define the use cases using the dynamic content from the translated object
  const useCases = [
    { name: 'price-drop', content: translatedContent.useCases.priceDrop },
    { name: 'low-stock', content: translatedContent.useCases.lowStock },
    { name: 'back-in-stock', content: translatedContent.useCases.backInStock },
    { name: 'wishlist-reminder', content: translatedContent.useCases.wishlistReminder },
    { name: 'wishlist-incentive', content: translatedContent.useCases.wishlistIncentive }
  ];

  // 3. Initialize Puppeteer and PDF Merger
  const browser = await puppeteer.launch();
  const merger = new PDFMerger();
  await fs.mkdir('./pdfs', { recursive: true });
  console.log("\n📄 Starting PDF generation process...");

  // 4. Generate Intro Page
  console.log("   -> Generating Intro page...");
  const filledIntro = introHtml
    .replace(/{{domain}}/g, readableDomain)
    .replace(/{{intro_headline}}/g, translatedContent.intro.headline)
    .replace(/{{intro_greeting}}/g, translatedContent.intro.greeting)
    .replace(/{{intro_p1}}/g, translatedContent.intro.p1)
    .replace(/{{intro_p2}}/g, translatedContent.intro.p2)
    .replace(/{{intro_li1}}/g, translatedContent.intro.li1)
    .replace(/{{intro_li2}}/g, translatedContent.intro.li2)
    .replace(/{{intro_li3}}/g, translatedContent.intro.li3)
    .replace(/{{intro_p3}}/g, translatedContent.intro.p3)
    .replace(/{{intro_p4}}/g, translatedContent.intro.p4)
    .replace(/{{intro_p5}}/g, translatedContent.intro.p5)
    .replace(/{{intro_footer}}/g, translatedContent.intro.footer);
  
  const introPage = await browser.newPage();
  await introPage.setContent(filledIntro, { waitUntil: 'networkidle0' });
  await introPage.pdf({ path: './pdfs/intro-page.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await merger.add('./pdfs/intro-page.pdf');
  await introPage.close();

  // 5. Generate Use Case Pages (Loop with conditional templates)
  for (let i = 0; i < useCases.length; i++) {
    const useCase = useCases[i];
    const product = products[i];
    let templateHtml;
    let filledHtml;

    console.log(`   -> Generating Use Case page: ${useCase.name}...`);

    // Conditionally load the correct template and apply its specific translations
    if (useCase.name === 'low-stock') {
        templateHtml = await fs.readFile('./templates/low-stock.html', 'utf8');
        filledHtml = templateHtml
            .replace(/{{lowStock_headline}}/g, translatedContent.lowStockTemplate.headline)
            .replace(/{{lowStock_metaPrefix}}/g, translatedContent.lowStockTemplate.metaPrefix)
            .replace(/{{lowStock_metaPrice}}/g, translatedContent.lowStockTemplate.metaPrice)
            .replace(/{{lowStock_warning}}/g, translatedContent.lowStockTemplate.warning)
            .replace(/{{lowStock_description}}/g, translatedContent.lowStockTemplate.description)
            .replace(/{{lowStock_buyNowButton}}/g, translatedContent.lowStockTemplate.buyNowButton)
            .replace(/{{lowStock_replyButton}}/g, translatedContent.lowStockTemplate.replyButton)
            .replace(/{{lowStock_forwardButton}}/g, translatedContent.lowStockTemplate.forwardButton);

    } else if (useCase.name === 'back-in-stock') {
        templateHtml = await fs.readFile('./templates/back-in-stock-template.html', 'utf8');
        filledHtml = templateHtml
            .replace(/{{backInStock_headline}}/g, translatedContent.backInStockTemplate.headline)
            .replace(/{{backInStock_metaPrefix}}/g, translatedContent.backInStockTemplate.metaPrefix)
            .replace(/{{backInStock_metaPrice}}/g, translatedContent.backInStockTemplate.metaPrice)
            .replace(/{{backInStock_description}}/g, translatedContent.backInStockTemplate.description)
            .replace(/{{backInStock_buyNowButton}}/g, translatedContent.backInStockTemplate.buyNowButton)
            .replace(/{{backInStock_replyButton}}/g, translatedContent.backInStockTemplate.replyButton)
            .replace(/{{backInStock_forwardButton}}/g, translatedContent.backInStockTemplate.forwardButton);

    } else { // Default to the price-drop template for all other use cases
        templateHtml = await fs.readFile('./templates/price-drop-template.html', 'utf8');
        filledHtml = templateHtml
            .replace(/{{headline}}/g, useCase.content.headline)
            .replace(/{{product_message}}/g, useCase.content.message)
            .replace(/{{priceDrop_greeting}}/g, translatedContent.priceDropTemplate.greeting)
            .replace(/{{priceDrop_originalPriceLabel}}/g, translatedContent.priceDropTemplate.originalPriceLabel)
            .replace(/{{priceDrop_newPriceLabel}}/g, translatedContent.priceDropTemplate.newPriceLabel)
            .replace(/{{priceDrop_buyNowButton}}/g, translatedContent.priceDropTemplate.buyNowButton)
            .replace(/{{priceDrop_replyButton}}/g, translatedContent.priceDropTemplate.replyButton)
            .replace(/{{priceDrop_forwardButton}}/g, translatedContent.priceDropTemplate.forwardButton);
    }

    // Apply common replacements for all templates (product data, etc.)
    filledHtml = filledHtml
        .replace(/{{to_email}}/g, TO_EMAIL)
        .replace(/{{from_email}}/g, FROM_EMAIL)
        .replace(/{{product_name}}/g, product.title)
        .replace(/{{product_price}}/g, product.price.toFixed(2))
        .replace(/{{new_price}}/g, product.newPrice)
        .replace(/{{product_image}}/g, product.imageLocalPath)
        .replace(/{{product_link}}/g, product.link);

    const page = await browser.newPage();
    await page.setContent(filledHtml, { waitUntil: 'networkidle0' });
    const pagePath = `./pdfs/${useCase.name}.pdf`;
    await page.pdf({ path: pagePath, format: 'A4', printBackground: true });
    await merger.add(pagePath);
    await page.close();
  }


  // 6. Generate POS Page
  console.log("   -> Generating POS page...");
  const wishlists = products.slice(0, 4);
  const backInStock = products.slice(1, 4);

  function renderProductGrid(sectionProducts) {
    return sectionProducts.map(p => `
      <div class="product-card">
        <img src="${p.imageThumbPath}" alt="${p.title}" class="product-image" />
        <p class="product-name">${p.title}</p>
      </div>
    `).join('\n');
  }

  const filledPOS = posHtml
    .replace(/{{pos_pageTitle}}/g, translatedContent.pos.pageTitle)
    .replace(/{{app_name}}/g, 'Wishlist Plus') // App name is a proper noun
    .replace(/{{edit_preferences_url}}/g, '#')
    .replace(/{{wishlist_view_all_url}}/g, '#')
    .replace(/{{bis_view_all_url}}/g, '#')
    .replace(/{{cart_view_all_url}}/g, '#')
    .replace(/{{pos_editPreferences}}/g, translatedContent.pos.editPreferences)
    .replace(/{{pos_wishlistHeader}}/g, translatedContent.pos.wishlistHeader)
    .replace(/{{pos_backInStockHeader}}/g, translatedContent.pos.backInStockHeader)
    .replace(/{{pos_viewAll}}/g, translatedContent.pos.viewAll)
    .replace(/{{#wishlists}}[\s\S]*?{{\/wishlists}}/g, renderProductGrid(wishlists))
    .replace(/{{#back_in_stock}}[\s\S]*?{{\/back_in_stock}}/g, renderProductGrid(backInStock));
  
  const posPage = await browser.newPage();
  await posPage.setContent(filledPOS, { waitUntil: 'networkidle0' });
  await posPage.pdf({ path: './pdfs/pos-page.pdf', printBackground: true, format: 'A4' });
  await merger.add('./pdfs/pos-page.pdf');
  await posPage.close();

  // 7. Generate Closing (Extro) Page
  console.log("   -> Generating Closing page...");
  const filledClosing = extroHtml
    .replace(/{{extro_headline}}/g, translatedContent.extro.headline)
    .replace(/{{extro_p1}}/g, translatedContent.extro.p1)
    .replace(/{{extro_p2}}/g, translatedContent.extro.p2)
    .replace(/{{extro_p3}}/g, translatedContent.extro.p3)
    .replace(/{{extro_p4}}/g, translatedContent.extro.p4)
    .replace(/{{extro_p5}}/g, translatedContent.extro.p5)
    .replace(/{{extro_ctaButton}}/g, translatedContent.extro.ctaButton)
    .replace(/{{extro_footer}}/g, translatedContent.extro.footer);

  const closingPage = await browser.newPage();
  await closingPage.setContent(filledClosing, { waitUntil: 'networkidle0' });
  await closingPage.pdf({ path: './pdfs/closing-page.pdf', format: 'A4', printBackground: true });
  await merger.add('./pdfs/closing-page.pdf');
  await closingPage.close();

  // 8. Save Final Merged PDF
  await merger.save(`${domainName}.pdf`);
  await browser.close();
  console.log(`\n✅ Final PDF saved as ${domainName}.pdf`);
}

async function getTranslatedContent(textContent, storeLanguage, brandTonality) {
  console.log(`\n🤖 Calling Gemini API for translation to [${storeLanguage}]...`);

  const prompt = `
    You are an expert marketing copywriter and localization specialist for e-commerce brands.
    Your task is to translate a JSON object of English text strings into a target language, perfectly matching a given brand's tonality.

    **Brand Tonality Context:**
    Here is a sample of the brand's language to understand their tone. It could be playful, formal, minimalist, etc. Adapt your translation to this style.
    ---
    ${brandTonality}
    ---

    **Instructions:**
    1.  The target language is: "${storeLanguage}".
    2.  Translate the **values** of the following JSON object.
    3.  Do NOT translate the JSON keys.
    4.  Preserve the exact original JSON structure.
    5.  Ensure the translated text flows naturally for a native speaker and matches the brand's tone.

    **JSON to Translate:**
    \`\`\`json
    ${JSON.stringify(textContent, null, 2)}
    \`\`\`

    **Your Response:**
    You MUST respond with ONLY the translated JSON object, enclosed in a single markdown JSON block. Do not add any other text, explanation, or commentary before or after the JSON.
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Clean the response to ensure it's valid JSON
    const jsonString = responseText.replace(/^```json\n/, '').replace(/\n```$/, '');
    
    console.log("✅ Gemini translation received.");
    return JSON.parse(jsonString);
  } catch (error) {
    console.error("❌ Error calling Gemini API:", error);
    console.warn("⚠️ Falling back to default English content.");
    return textContent; // Return original English text on failure
  }
}

// MAIN EXECUTION BLOCK
(async () => {
    const baseUrl = inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`;
    const FROM_EMAIL = getFromEmail(baseUrl);
    const domainName = getSafeDomainName(baseUrl);
    const readableDomain = getReadableDomain(baseUrl);
  
    // 1. Scrape store info
    const aboutText = await scrapeAboutText(baseUrl);
    const { productUrls, storeLanguage } = await scrapeProductUrls(baseUrl);
  
    console.log(`\n✅ Store Language: ${storeLanguage}`);
    console.log(`✅ Brand Language Sample: ${aboutText}\n`);
    
    // 2. Get translated content from Gemini
    const translatedContent = await getTranslatedContent(textContent, storeLanguage, aboutText);
  
    // 3. Scrape product details
    const products = [];
    for (const url of productUrls) {
      if (products.length >= MAX_PRODUCTS) break;
      const details = await scrapeProductDetails(url);
      if (details) {
        products.push(details);
      }
    }
  
    if (products.length < MAX_PRODUCTS) {
      console.log('❌ Not enough valid products found.');
      process.exit(1);
    }
  
    console.log(`✅ Final valid products: ${products.length}`);
    
    // 4. Generate PDF with the translated content
    await generateCombinedPDF(products, FROM_EMAIL, TO_EMAIL, domainName, readableDomain, translatedContent);
    
    process.exit(0);
  })();