import { randomDelay } from './utils.js';

/**
 * Extract detailed information from a business page
 * Only used when scrapeDetails option is enabled
 * @param {Object} page - Puppeteer page
 * @param {Object} business - Business object to enhance
 */
export async function extractBusinessDetails(page, business) {
    console.log(`  → Extracting details for: ${business.name}`);

    try {
        // Wait for content to load
        await page.waitForSelector('h1', { timeout: 15000 });
        await randomDelay(2000, 3000);

        const details = await page.evaluate(() => {
            const data = {};

            // Extract business name from h1 heading
            const nameEl = document.querySelector('h1');
            data.name = nameEl ? nameEl.textContent.trim() : null;

            // Extract rating - look for element with "X stars" or "X.X stars" aria-label
            const ratingEl = document.querySelector('[aria-label*="stars"]') ||
                            document.querySelector('[aria-label*="star"]');
            if (ratingEl) {
                const ariaLabel = ratingEl.getAttribute('aria-label');
                const ratingMatch = ariaLabel?.match(/([\d.]+)\s*star/i);
                if (ratingMatch) {
                    data.rating = parseFloat(ratingMatch[1]);
                }
            }

            // Extract review count - look for button/element with "X review" or "X reviews"
            // The review count button usually has text like "119 reviews"
            const reviewElements = document.querySelectorAll('[aria-label*="review"], button');
            for (const el of reviewElements) {
                const ariaLabel = el.getAttribute('aria-label') || '';
                const textContent = el.textContent || '';
                
                // Match patterns like "119 reviews" or "119 review"
                const reviewMatch = ariaLabel.match(/^(\d+[\d,]*)\s*review/i) ||
                                   textContent.match(/^(\d+[\d,]*)\s*review/i);
                if (reviewMatch) {
                    data.reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
                    break;
                }
            }

            // Alternative: look for review count in a span near the rating
            if (!data.reviewCount) {
                const allSpans = document.querySelectorAll('span');
                for (const span of allSpans) {
                    const text = span.textContent?.trim() || '';
                    const match = text.match(/^(\d+[\d,]*)\s*review/i);
                    if (match) {
                        data.reviewCount = parseInt(match[1].replace(/,/g, ''));
                        break;
                    }
                }
            }

            // Extract address - button with aria-label starting with "Address:"
            const allButtons = document.querySelectorAll('button[aria-label]');
            for (const btn of allButtons) {
                const label = btn.getAttribute('aria-label') || '';
                
                if (label.startsWith('Address:')) {
                    data.address = label.replace('Address:', '').trim();
                }
                if (label.startsWith('Phone:')) {
                    data.phone = label.replace('Phone:', '').trim();
                }
                if (label.startsWith('Plus code:')) {
                    data.plusCode = label.replace('Plus code:', '').trim();
                }
            }

            // Extract website - link with aria-label containing "Website:"
            const websiteLinks = document.querySelectorAll('a[aria-label*="Website"], a[data-item-id*="authority"]');
            for (const link of websiteLinks) {
                if (link.href && !link.href.includes('google.com')) {
                    data.website = link.href;
                    break;
                }
            }
            
            // Alternative website extraction
            if (!data.website) {
                const allLinks = document.querySelectorAll('a[href]');
                for (const link of allLinks) {
                    const ariaLabel = link.getAttribute('aria-label') || '';
                    if (ariaLabel.toLowerCase().includes('website') || 
                        ariaLabel.toLowerCase().includes('open website')) {
                        if (link.href && !link.href.includes('google.com')) {
                            data.website = link.href;
                            break;
                        }
                    }
                }
            }

            // Extract hours status
            const hoursButton = document.querySelector('button[data-item-id*="hours"]');
            if (hoursButton) {
                const ariaLabel = hoursButton.getAttribute('aria-label');
                data.hoursStatus = ariaLabel || null;
            } else {
                // Look for Open/Closed status in buttons
                for (const btn of allButtons) {
                    const label = btn.getAttribute('aria-label') || '';
                    if (label.includes('Open') || label.includes('Closed') || label.includes('Opens') || label.includes('Closes')) {
                        data.hoursStatus = label;
                        break;
                    }
                }
            }

            // Extract category/type - look for category button or text
            const categoryButton = document.querySelector('button[jsaction*="category"]');
            if (categoryButton) {
                data.category = categoryButton.textContent.trim();
            } else {
                // Look for category in spans with specific patterns
                const spans = document.querySelectorAll('span');
                for (const span of spans) {
                    const text = span.textContent?.trim() || '';
                    // Categories often end with "service", "restaurant", "shop", etc.
                    if (text.length > 3 && text.length < 50 && 
                        !text.match(/^\d/) && 
                        !text.includes('review') &&
                        !text.includes('star') &&
                        (text.toLowerCase().includes('service') || 
                         text.toLowerCase().includes('cleaning') ||
                         text.toLowerCase().includes('restaurant') ||
                         text.toLowerCase().includes('shop') ||
                         text.toLowerCase().includes('store') ||
                         text.match(/^[A-Z][a-z]+\s+[a-z]+$/))) {
                        data.category = text;
                        break;
                    }
                }
            }

            // Extract price level
            const priceEl = document.querySelector('[aria-label*="Price"]');
            data.priceLevel = priceEl ? priceEl.getAttribute('aria-label') : null;

            return data;
        });

        // Merge details with business object, but only update if we got new data
        if (details.name) business.name = details.name;
        if (details.rating !== undefined && details.rating !== null) business.rating = details.rating;
        if (details.reviewCount !== undefined && details.reviewCount !== null) business.reviewCount = details.reviewCount;
        if (details.address) business.address = details.address;
        if (details.phone) business.phone = details.phone;
        if (details.website) business.website = details.website;
        if (details.hoursStatus) business.hoursStatus = details.hoursStatus;
        if (details.category) business.category = details.category;
        if (details.priceLevel) business.priceLevel = details.priceLevel;
        if (details.plusCode) business.plusCode = details.plusCode;

        console.log(`  ✓ Details extracted for: ${business.name} (Rating: ${business.rating}, Reviews: ${business.reviewCount})`);
    } catch (error) {
        console.error(`  ✗ Error extracting details for ${business.name}:`, error.message);
    }
}

