import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import fsSync from 'fs';
import axios from 'axios';
import sharp from 'sharp';
import path from 'path';
import puppeteer from 'puppeteer';
import PDFMerger from 'pdf-merger-js';

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
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'text/html',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  return await res.text();
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

  for (const url of urlsToTry) {
    console.log(`🌐 Visiting: ${url}`);
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

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
  return productUrls;
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

async function generateCombinedPDF(products, FROM_EMAIL, TO_EMAIL, domainName, readableDomain) {
  const templateHtml = await fs.readFile('./templates/price-drop-template.html', 'utf8');
  const introHtml = await fs.readFile('./templates/intro-page.html', 'utf8');
  const posHtml = await fs.readFile('./templates/pos.html', 'utf8');

  const useCases = [
    { name: 'price-drop', headline: 'Price Drop Alert!', message: 'Good news — an item on your wishlist just dropped in price, grab it before it\’s gone!' },
    { name: 'low-stock', headline: 'Low Stock Warning!', message: 'Don’t forget — your saved items are waiting for you. Make them yours!' },
    { name: 'back-in-stock', headline: 'Back in Stock!', message: 'Great news — an item from your wishlist is back in stock. Make it yours before it’s gone!' },
    { name: 'wishlist-reminder', headline: 'Don\'t Forget Your Wishlist!', message: 'You’ve saved this cool item to your wishlist. Ready to make it yours?' },
    { name: 'wishlist-incentive', headline: 'Wish to Win!', message: 'Hurry — an item on your wishlist is almost sold out. Grab it before it’s gone!' }
  ];

  const browser = await puppeteer.launch();
  const merger = new PDFMerger();

  await fs.mkdir('./pdfs', { recursive: true });

  // ✅ Intro page
  const filledIntro = introHtml.replace(/{{domain}}/g, readableDomain);
  const introPage = await browser.newPage();
  await introPage.setContent(filledIntro, { waitUntil: 'networkidle0' });
  await introPage.pdf({ path: './pdfs/intro-page.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await merger.add('./pdfs/intro-page.pdf');
  await introPage.close();
  console.log('✅ Added intro page');

  // ✅ Use case pages
  for (let i = 0; i < useCases.length; i++) {
    const useCase = useCases[i];
    const product = products[i];

    const filledHtml = templateHtml
      .replace(/{{to_email}}/g, TO_EMAIL)
      .replace(/{{from_email}}/g, FROM_EMAIL)
      .replace(/{{headline}}/g, useCase.headline)
      .replace(/{{product_message}}/g, useCase.message)
      .replace(/{{product_name}}/g, product.title)
      .replace(/{{product_price}}/g, product.price.toFixed(2))
      .replace(/{{new_price}}/g, product.newPrice)
      .replace(/{{product_image}}/g, product.imageLocalPath)
      .replace(/{{product_link}}/g, product.link);

    const page = await browser.newPage();
    await page.setContent(filledHtml, { waitUntil: 'networkidle0' });
    const pagePath = `./pdfs/${useCase.name}.pdf`;
    await page.pdf({ path: pagePath, format: 'A4', printBackground: true, preferCSSPageSize: true, width: '210mm', height: '210mm' });
    await merger.add(pagePath);
    await page.close();
    console.log(`✅ Added ${useCase.name} page`);
  }

  // ✅ POS page uses thumbnails!
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

  let filledPOS = posHtml
    .replace(/{{page_title}}/g, 'View shopper wishlist on the in-store POS terminal')
    .replace(/{{app_name}}/g, 'Wishlist Plus')
    .replace(/{{edit_preferences_url}}/g, '#')
    .replace(/{{wishlist_view_all_url}}/g, '#')
    .replace(/{{bis_view_all_url}}/g, '#')
    .replace(/{{cart_view_all_url}}/g, '#')
    .replace(/{{#wishlists}}[\s\S]*?{{\/wishlists}}/g, renderProductGrid(wishlists))
    .replace(/{{#back_in_stock}}[\s\S]*?{{\/back_in_stock}}/g, renderProductGrid(backInStock));

  await fs.writeFile('./filled-pos3.html', filledPOS);

  const posPage = await browser.newPage();
  await posPage.setContent(filledPOS, { waitUntil: 'networkidle0' });
  await posPage.pdf({ path: './pdfs/pos-page.pdf', printBackground: true, preferCSSPageSize: true, width: '210mm', height: '210mm', scale: 0.8, margin: { top: '2mm', bottom: '2mm', left: '2mm', right: '2mm' } });
  await merger.add('./pdfs/pos-page.pdf');
  await posPage.close();
  console.log('✅ Added final POS page');

  // ✅ Closing page stays the same
  const closingHtml = await fs.readFile('./templates/extro.html', 'utf8');
  const filledClosing = closingHtml.replace(/{{domain}}/g, readableDomain);

  const closingPage = await browser.newPage();
  await closingPage.setContent(filledClosing, { waitUntil: 'networkidle0' });
  await closingPage.pdf({
    path: './pdfs/closing-page.pdf',
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true
  });
  await merger.add('./pdfs/closing-page.pdf');
  await closingPage.close();
  console.log('✅ Added final closing page');

  // ✅ Save final PDF
  await merger.save(`${domainName}.pdf`);
  await browser.close();
  console.log(`✅ Final PDF saved as ${domainName}.pdf`);
}

(async () => {
  const baseUrl = inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`;
  const FROM_EMAIL = getFromEmail(baseUrl);
  const domainName = getSafeDomainName(baseUrl);
  const readableDomain = getReadableDomain(baseUrl);

  const productUrls = await scrapeProductUrls(baseUrl);

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
  await generateCombinedPDF(products, FROM_EMAIL, TO_EMAIL, domainName, readableDomain);
  process.exit(0);
})();
