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
 * @param {number} maxResults - Maximum results needed
 * @returns {Object} - Scroll count and whether end was reached
 */
async function scrollSidebar(page, maxResults) {
    // Calculate max scrolls based on results needed
    // Each scroll loads approximately 5-10 results, so we need roughly maxResults/5 scrolls
    // Add extra buffer for safety, cap at 300 scrolls max to prevent infinite scrolling
    const maxScrolls = Math.min(300, Math.max(5, Math.ceil(maxResults / 5) + 10));
    
    let scrollCount = 0;
    let previousHeight = 0;
    let noChangeCount = 0;

    console.log(`📜 Will scroll up to ${maxScrolls} times to load ${maxResults} results...`);

    while (scrollCount < maxScrolls) {
        // Check how many results we currently have loaded
        const currentResultCount = await page.evaluate(() => {
            const articles = document.querySelectorAll('div[role="article"]');
            const links = document.querySelectorAll('a[href*="/maps/place/"]');
            return Math.max(articles.length, links.length);
        });

        // If we have enough results, stop scrolling early
        if (currentResultCount >= maxResults) {
            console.log(`✓ Already have ${currentResultCount} results loaded, stopping early after ${scrollCount} scrolls`);
            return { scrollCount, reachedEnd: false, resultsLoaded: currentResultCount };
        }

        // Scroll the results sidebar
        const scrollResult = await page.evaluate(() => {
            const sidebar = document.querySelector('[role="feed"]') ||
                          document.querySelector('div[class*="scrollable"]') ||
                          document.querySelector('[aria-label*="Results"]');

            if (sidebar) {
                sidebar.scrollTop = sidebar.scrollHeight;
                return { height: sidebar.scrollHeight, found: true };
            }
            return { height: 0, found: false };
        });

        await randomDelay(1500, 2500);

        // Check for "end of list" indicator
        const reachedEnd = await page.evaluate(() => {
            const pageText = document.body.innerText || '';
            return pageText.includes("You've reached the end of the list") ||
                   pageText.includes("No more results") ||
                   pageText.includes("Can't find more places");
        });

        if (reachedEnd) {
            console.log(`✓ Reached end of Google Maps results after ${scrollCount} scrolls`);
            const finalCount = await page.evaluate(() => {
                return document.querySelectorAll('div[role="article"]').length;
            });
            return { scrollCount, reachedEnd: true, resultsLoaded: finalCount };
        }

        // Check if height changed
        if (scrollResult.height === previousHeight || scrollResult.height === 0) {
            noChangeCount++;
            // Wait a bit longer and try again (Google Maps can be slow to load)
            if (noChangeCount >= 3) {
                console.log(`✓ No new content after ${noChangeCount} attempts, stopping at ${scrollCount} scrolls`);
                const finalCount = await page.evaluate(() => {
                    return document.querySelectorAll('div[role="article"]').length;
                });
                return { scrollCount, reachedEnd: true, resultsLoaded: finalCount };
            }
            await randomDelay(2000, 3000);
        } else {
            noChangeCount = 0;
        }

        previousHeight = scrollResult.height;
        scrollCount++;

        // Log progress every 10 scrolls
        if (scrollCount % 10 === 0) {
            console.log(`   Scrolled ${scrollCount} times, loaded ~${currentResultCount} results so far...`);
        }
    }

    const finalCount = await page.evaluate(() => {
        return document.querySelectorAll('div[role="article"]').length;
    });
    console.log(`✓ Completed maximum ${scrollCount} scrolls, loaded ${finalCount} results`);
    return { scrollCount, reachedEnd: false, resultsLoaded: finalCount };
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
        const seenUrls = new Set();

        // Method 1: Find article elements (search result cards)
        const articles = document.querySelectorAll('div[role="article"]');
        
        for (const article of articles) {
            if (results.length >= max) break;
            
            try {
                // Get the link to the place
                const link = article.querySelector('a[href*="/maps/place/"]');
                if (!link) continue;
                
                const url = link.href;
                if (seenUrls.has(url)) continue;
                seenUrls.add(url);

                // Extract business name from aria-label or link text
                let name = article.getAttribute('aria-label') || 
                          link.getAttribute('aria-label') ||
                          link.textContent?.trim();
                
                // Clean up the name
                if (name) {
                    name = name.split('·')[0].trim();
                }
                
                if (!name || name === '') {
                    name = 'Unknown Business';
                }

                // Extract rating and review count from text content
                let rating = null;
                let reviewCount = null;
                
                // Look for rating pattern like "4.8" or "4.8(119)"
                const textContent = article.textContent || '';
                
                // Match rating pattern: number followed by stars or parentheses
                const ratingMatch = textContent.match(/(\d+\.?\d*)\s*(?:stars?|\()/i);
                if (ratingMatch) {
                    rating = parseFloat(ratingMatch[1]);
                }
                
                // Match review count in parentheses: (119) or (1,234)
                const reviewMatch = textContent.match(/\(([0-9,]+)\)/);
                if (reviewMatch) {
                    reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
                }

                // Extract category - usually after the rating info
                let category = null;
                const spans = article.querySelectorAll('span');
                for (const span of spans) {
                    const text = span.textContent?.trim();
                    // Category is usually a short text without numbers or special chars
                    if (text && 
                        text.length > 3 && 
                        text.length < 50 && 
                        !text.match(/^\d/) && 
                        !text.includes('(') &&
                        !text.includes('·') &&
                        !text.includes('Open') &&
                        !text.includes('Closed') &&
                        !text.includes('$')) {
                        // Check if it looks like a category (capitalize words)
                        if (text.match(/^[A-Z][a-z]/) || text.includes('service') || text.includes('cleaning')) {
                            category = text;
                            break;
                        }
                    }
                }

                results.push({
                    name: name,
                    url: url,
                    rating: rating,
                    reviewCount: reviewCount,
                    category: category,
                    addressSnippet: null,
                    scrapedAt: new Date().toISOString()
                });
            } catch (error) {
                console.error('Error extracting business:', error.message);
            }
        }

        // Method 2: If no articles found, try direct link approach
        if (results.length === 0) {
            const links = document.querySelectorAll('a[href*="/maps/place/"]');
            
            for (const link of links) {
                if (results.length >= max) break;
                
                try {
                    const url = link.href;
                    if (seenUrls.has(url)) continue;
                    seenUrls.add(url);

                    // Get name from aria-label or text
                    let name = link.getAttribute('aria-label') || link.textContent?.trim();
                    if (name) {
                        name = name.split('·')[0].trim();
                    }
                    if (!name || name === '') {
                        name = 'Unknown Business';
                    }

                    results.push({
                        name: name,
                        url: url,
                        rating: null,
                        reviewCount: null,
                        category: null,
                        addressSnippet: null,
                        scrapedAt: new Date().toISOString()
                    });
                } catch (error) {
                    console.error('Error extracting business link:', error.message);
                }
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
        maxResults: inputMaxResults,
        scrapeDetails = false,
        proxyConfiguration: proxyConfig = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
        minDelay = 1,
        maxDelay = 3
    } = input;

    // Handle maxResults: default 100, if 0 or blank = unlimited
    const isUnlimited = inputMaxResults === 0 || inputMaxResults === null || inputMaxResults === undefined || inputMaxResults === '';
    const maxResults = isUnlimited ? Infinity : inputMaxResults;

    // Validate input
    if (!searchQuery || !searchQuery.trim()) {
        throw new Error('searchQuery is required!');
    }

    console.log('✓ Input validation passed');
    console.log(`🔍 Search query: ${searchQuery}`);
    console.log(`📍 Location: ${location || 'Not specified'}`);
    console.log(`🎯 Max results: ${isUnlimited ? 'Unlimited' : maxResults}`);
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

                    // Scroll sidebar to load results (smart scrolling based on maxResults)
                    const scrollResult = await scrollSidebar(page, maxResults);
                    log.info(`✓ Scrolling complete: ${scrollResult.scrollCount} scrolls, ~${scrollResult.resultsLoaded} results loaded${scrollResult.reachedEnd ? ' (reached end)' : ''}`);

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
