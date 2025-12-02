import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset } from 'crawlee';

/**
 * Random delay to simulate human behavior
 * @param {number} min - Minimum delay in milliseconds
 * @param {number} max - Maximum delay in milliseconds
 */
async function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Construct Google Maps search URL
 * @param {string} searchQuery - What to search for (e.g., "restaurants in Dubai")
 * @param {string} location - Optional location override
 * @returns {string} Google Maps search URL
 */
function constructGoogleMapsUrl(searchQuery, location = null) {
    const baseUrl = 'https://www.google.com/maps/search/';

    let query = searchQuery.trim();
    if (location && location.trim()) {
        query = `${query} in ${location.trim()}`;
    }

    // Force English language with hl=en parameter
    return `${baseUrl}${encodeURIComponent(query)}?hl=en`;
}

/**
 * Scroll the sidebar to load more results
 * @param {Object} page - Puppeteer page
 * @param {number} maxScrolls - Maximum scrolls
 */
async function scrollSidebar(page, maxScrolls = 20) {
    let scrollCount = 0;
    let previousHeight = 0;

    while (scrollCount < maxScrolls) {
        // Scroll the results sidebar
        const newHeight = await page.evaluate(() => {
            const sidebar = document.querySelector('[role="feed"]') ||
                          document.querySelector('div[class*="scrollable"]') ||
                          document.querySelector('[aria-label*="Results"]');

            if (sidebar) {
                sidebar.scrollTop = sidebar.scrollHeight;
                return sidebar.scrollHeight;
            }
            return 0;
        });

        await randomDelay(1500, 2500);

        if (newHeight === previousHeight || newHeight === 0) {
            console.log(`✓ Reached end of results after ${scrollCount} scrolls`);
            break;
        }

        previousHeight = newHeight;
        scrollCount++;
    }

    return scrollCount;
}

/**
 * Extract business listings from Google Maps search results
 * @param {Object} page - Puppeteer page
 * @param {number} maxResults - Maximum results to extract
 * @returns {Array} Array of business objects
 */
async function extractBusinessListings(page, maxResults) {
    console.log('📊 Extracting business listings from Google Maps...');

    const businesses = await page.evaluate((max) => {
        const results = [];

        // Find all business result cards
        const businessCards = document.querySelectorAll('a[href*="/maps/place/"]');

        for (let i = 0; i < businessCards.length && results.length < max; i++) {
            try {
                const card = businessCards[i];
                const parent = card.closest('[class*="card"]') || card.closest('div[role="article"]') || card.parentElement;

                // Extract business name
                const nameEl = card.querySelector('[class*="fontHeadline"]') ||
                             card.querySelector('div[class*="title"]') ||
                             card.querySelector('[aria-label]');
                const name = nameEl ? (nameEl.textContent || nameEl.getAttribute('aria-label')) : 'Unknown Business';

                // Extract URL
                const url = card.href;

                // Extract rating
                let rating = null;
                const ratingEl = parent?.querySelector('[role="img"][aria-label*="stars"]') ||
                               parent?.querySelector('span[aria-label*="star"]');
                if (ratingEl) {
                    const ariaLabel = ratingEl.getAttribute('aria-label');
                    const match = ariaLabel?.match(/([\d.]+)\s*star/i);
                    if (match) rating = match[1];
                }

                // Extract review count
                let reviewCount = null;
                const reviewEl = parent?.querySelector('[aria-label*="review"]');
                if (reviewEl) {
                    const text = reviewEl.textContent || reviewEl.getAttribute('aria-label');
                    const match = text?.match(/([\d,]+)\s*review/i);
                    if (match) reviewCount = match[1].replace(/,/g, '');
                }

                // Extract category
                let category = null;
                const categoryEls = parent?.querySelectorAll('span[class*="fontBody"]');
                if (categoryEls && categoryEls.length > 0) {
                    for (const el of categoryEls) {
                        const text = el.textContent?.trim();
                        if (text && !text.includes('$') && !text.includes('·') && text.length < 50) {
                            category = text;
                            break;
                        }
                    }
                }

                // Extract address snippet
                let addressSnippet = null;
                const addressEl = parent?.querySelector('[class*="address"]');
                if (addressEl) {
                    addressSnippet = addressEl.textContent?.trim();
                }

                // Only add if we have at least a name and URL
                if (name && url && url.includes('/maps/place/')) {
                    results.push({
                        name: name.trim(),
                        url,
                        rating: rating ? parseFloat(rating) : null,
                        reviewCount: reviewCount ? parseInt(reviewCount) : null,
                        category,
                        addressSnippet,
                        scrapedAt: new Date().toISOString()
                    });
                }
            } catch (error) {
                console.error(`Error extracting business ${i}:`, error.message);
            }
        }

        return results;
    }, maxResults);

    console.log(`✓ Found ${businesses.length} businesses`);
    return businesses;
}

/**
 * Extract detailed information from a business page
 * @param {Object} page - Puppeteer page
 * @param {Object} business - Business object to enhance
 */
async function extractBusinessDetails(page, business) {
    console.log(`  → Extracting details for: ${business.name}`);

    try {
        // Wait for content to load
        await page.waitForSelector('h1', { timeout: 10000 });
        await randomDelay(2000, 3000);

        const details = await page.evaluate(() => {
            const data = {};

            // Extract business name (confirmation)
            const nameEl = document.querySelector('h1');
            data.name = nameEl ? nameEl.textContent.trim() : null;

            // Extract rating and review count
            const ratingEl = document.querySelector('[aria-label*="stars"]');
            if (ratingEl) {
                const ariaLabel = ratingEl.getAttribute('aria-label');
                const ratingMatch = ariaLabel?.match(/([\d.]+)\s*star/i);
                const reviewMatch = ariaLabel?.match(/([\d,]+)\s*review/i);
                data.rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
                data.reviewCount = reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, '')) : null;
            }

            // Extract address
            const addressButton = document.querySelector('button[data-item-id*="address"]');
            if (addressButton) {
                data.address = addressButton.getAttribute('aria-label')?.replace('Address: ', '') || null;
            }

            // Extract phone
            const phoneButton = document.querySelector('button[data-item-id*="phone"]');
            if (phoneButton) {
                data.phone = phoneButton.getAttribute('aria-label')?.replace(/Phone:\s*/i, '') || null;
            }

            // Extract website
            const websiteLink = document.querySelector('a[data-item-id*="authority"]');
            if (websiteLink) {
                data.website = websiteLink.href || null;
            }

            // Extract hours
            const hoursButton = document.querySelector('button[data-item-id*="hours"]');
            if (hoursButton) {
                const ariaLabel = hoursButton.getAttribute('aria-label');
                data.hoursStatus = ariaLabel || null;
            }

            // Extract category/type
            const categoryButton = document.querySelector('button[jsaction*="category"]');
            data.category = categoryButton ? categoryButton.textContent.trim() : null;

            // Extract price level
            const priceEl = document.querySelector('[aria-label*="Price"]');
            data.priceLevel = priceEl ? priceEl.getAttribute('aria-label') : null;

            return data;
        });

        // Merge details with business object
        Object.assign(business, details);

        // Extract reviews if requested
        // (Can be added as an option)

        console.log(`  ✓ Details extracted for: ${business.name}`);
    } catch (error) {
        console.error(`  ✗ Error extracting details for ${business.name}:`, error.message);
    }
}

/**
 * Main actor entry point
 */
await Actor.main(async () => {
    console.log('🗺️  Starting Google Maps Scraper...');

    // Get input
    const input = await Actor.getInput();

    if (!input) {
        throw new Error('No input provided!');
    }

    const {
        searchQuery,
        location = null,
        maxResults = 100,
        scrapeDetails = false,
        proxyConfiguration: proxyConfig = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
        minDelay = 1,
        maxDelay = 3
    } = input;

    // Validate input
    if (!searchQuery || !searchQuery.trim()) {
        throw new Error('searchQuery is required!');
    }

    console.log('✓ Input validation passed');
    console.log(`🔍 Search query: ${searchQuery}`);
    console.log(`📍 Location: ${location || 'Not specified'}`);
    console.log(`🎯 Max results: ${maxResults}`);
    console.log(`📄 Scrape details: ${scrapeDetails ? 'Yes' : 'No'}`);
    console.log(`🔒 Use Apify proxy: ${proxyConfig?.useApifyProxy ? 'Yes' : 'No'}`);
    if (proxyConfig?.useApifyProxy) {
        console.log(`   Proxy groups: ${proxyConfig.apifyProxyGroups?.join(', ') || 'AUTO'}`);
        if (proxyConfig.apifyProxyCountry) {
            console.log(`   Proxy country: ${proxyConfig.apifyProxyCountry}`);
        }
    }

    // Construct Google Maps URL
    const startUrl = constructGoogleMapsUrl(searchQuery, location);
    console.log(`🌐 Starting URL: ${startUrl}`);

    // Track scraped businesses
    let scrapedCount = 0;
    const scrapedUrls = new Set();

    // Configure proxy
    let proxyConfiguration;
    if (proxyConfig?.useApifyProxy) {
        proxyConfiguration = await Actor.createProxyConfiguration({
            groups: proxyConfig.apifyProxyGroups,
            countryCode: proxyConfig.apifyProxyCountry
        });
    } else if (proxyConfig?.proxyUrls?.length > 0) {
        proxyConfiguration = await Actor.createProxyConfiguration({
            proxyUrls: proxyConfig.proxyUrls
        });
    }

    // Create crawler
    const crawler = new PuppeteerCrawler({
        proxyConfiguration,
        maxRequestsPerCrawl: scrapeDetails ? maxResults * 2 : 1,
        maxConcurrency: 1, // Google Maps requires low concurrency
        requestHandlerTimeoutSecs: 180,
        navigationTimeoutSecs: 60,
        launchContext: {
            launchOptions: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                    '--window-size=1920,1080',
                    '--lang=en-US,en'
                ]
            },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },

        async requestHandler({ page, request, log }) {
            const url = request.url;

            // Force English language in HTTP headers
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9'
            });

            // Check if this is search results or business details page
            const isSearchPage = url.includes('/maps/search/');
            const isBusinessPage = url.includes('/maps/place/');

            if (isBusinessPage && scrapeDetails) {
                // Extract business details
                const { business } = request.userData;

                if (!business) {
                    log.warning('No business data in userData');
                    return;
                }

                await extractBusinessDetails(page, business);
                await Dataset.pushData(business);
                log.info(`✓ Saved details for: ${business.name}`);

                await randomDelay(minDelay * 1000, maxDelay * 1000);

            } else if (isSearchPage) {
                log.info(`📄 Processing search results: ${url}`);

                try {
                    // Wait for page to load
                    await page.waitForSelector('[role="feed"], [aria-label*="Results"]', { timeout: 30000 });
                    await randomDelay(3000, 5000);

                    // Handle cookie consent if present
                    try {
                        const cookieButton = await page.$('button:has-text("Accept all"), button:has-text("I agree")');
                        if (cookieButton) {
                            await cookieButton.click();
                            await randomDelay(1000, 2000);
                            log.info('✓ Accepted cookies');
                        }
                    } catch (e) {
                        // No cookie banner
                    }

                    // Scroll sidebar to load all results
                    log.info('📜 Scrolling to load more results...');
                    const scrollCount = await scrollSidebar(page, 30);
                    log.info(`✓ Completed ${scrollCount} scrolls`);

                    await randomDelay(2000, 3000);

                    // Extract businesses
                    const businesses = await extractBusinessListings(page, maxResults);

                    if (businesses.length === 0) {
                        log.warning('⚠️ No businesses found. Try adjusting your search query.');
                        return;
                    }

                    // Save or process businesses
                    const newBusinesses = [];
                    for (const business of businesses) {
                        if (scrapedCount >= maxResults) break;

                        if (!scrapedUrls.has(business.url)) {
                            scrapedUrls.add(business.url);
                            newBusinesses.push(business);
                            scrapedCount++;

                            if (scrapeDetails) {
                                // Add business detail page to queue
                                await crawler.addRequests([{
                                    url: business.url,
                                    userData: { business }
                                }]);
                            } else {
                                // Save immediately if not scraping details
                                await Dataset.pushData(business);
                            }
                        }
                    }

                    log.info(`✓ Found ${newBusinesses.length} new businesses (Total: ${scrapedCount}/${maxResults})`);

                } catch (error) {
                    log.error(`Error processing search page: ${error.message}`);
                    throw error;
                }
            }
        },

        async failedRequestHandler({ request, log }, error) {
            log.error(`Request ${request.url} failed: ${error.message}`);
        }
    });

    // Start crawling
    console.log('🕷️  Starting crawler...');
    await crawler.run([startUrl]);

    // Final stats
    console.log('\n📊 Scraping completed!');
    console.log(`✓ Total businesses scraped: ${scrapedCount}`);
    console.log(`✓ Data saved to dataset`);

    if (scrapedCount === 0) {
        console.log('\n⚠️ WARNING: No businesses were scraped!');
        console.log('Try:');
        console.log('- Adjusting your search query');
        console.log('- Adding a location');
        console.log('- Using a more specific search term');
    }

    console.log('\n✅ Actor finished successfully!');
});
