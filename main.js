import { Actor } from 'apify';
import { PuppeteerCrawler, Dataset } from 'crawlee';
import { randomDelay, constructGoogleMapsUrl, captureDebugScreenshot } from './utils/utils.js';
import { scrollSidebar } from './utils/scroll.js';
import { extractBusinessListings } from './utils/listingExtractor.js';
import { extractBusinessDetails } from './utils/detailsExtractor.js';

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
        maxDelay = 3,
        debugScreenshots = false,
        skipSponsored = false,
        skipWithWebsite = false,
        skipWithPhone = false,
        skipWithoutContact = false
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
    console.log(`📸 Debug screenshots: ${debugScreenshots ? 'Yes' : 'No'}`);
    console.log(`🚫 Skip sponsored: ${skipSponsored ? 'Yes' : 'No'}`);
    console.log(`🚫 Skip with website: ${skipWithWebsite ? 'Yes' : 'No'}`);
    console.log(`🚫 Skip with phone: ${skipWithPhone ? 'Yes' : 'No'}`);
    console.log(`🚫 Skip without contact: ${skipWithoutContact ? 'Yes' : 'No'}`);
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
                
                // Clean data types before saving
                const cleanBusiness = {
                    name: String(business.name || 'Unknown'),
                    url: String(business.url || ''),
                    rating: business.rating !== null ? Number(business.rating) : null,
                    reviewCount: business.reviewCount !== null ? parseInt(business.reviewCount) : null,
                    category: business.category || null,
                    address: business.address || null,
                    phone: business.phone || null,
                    website: business.website || null,
                    hoursStatus: business.hoursStatus || null,
                    priceLevel: business.priceLevel || null,
                    plusCode: business.plusCode || null,
                    isSponsored: Boolean(business.isSponsored),
                    scrapedAt: business.scrapedAt || new Date().toISOString()
                };
                await Dataset.pushData(cleanBusiness);
                log.info(`✓ Saved details for: ${cleanBusiness.name}`);

                await randomDelay(minDelay * 1000, maxDelay * 1000);

            } else if (isSearchPage) {
                log.info(`📄 Processing search results: ${url}`);

                try {
                    // Handle EU cookie consent FIRST (appears before results load in EU)
                    // Google's GDPR consent dialog blocks the page until accepted
                    await randomDelay(2000, 3000);
                    
                    try {
                        // Try multiple selectors for Google's consent dialog
                        // The consent form typically appears in an iframe or directly on page
                        const consentSelectors = [
                            'button[aria-label="Accept all"]',
                            'button[aria-label="Reject all"]', // Fallback - either works to dismiss
                            '[aria-label="Accept all"]',
                            'form[action*="consent"] button',
                            'button:first-of-type', // In consent dialogs, first button is usually "Reject"
                        ];
                        
                        // Check for consent dialog
                        const consentForm = await page.$('form[action*="consent"]');
                        if (consentForm) {
                            log.info('🍪 Cookie consent dialog detected, attempting to dismiss...');
                            
                            // Look for "Accept all" or "Reject all" button
                            for (const selector of consentSelectors) {
                                try {
                                    const button = await page.$(selector);
                                    if (button) {
                                        const buttonText = await page.evaluate(el => el.textContent, button);
                                        if (buttonText && (buttonText.includes('Accept') || buttonText.includes('Reject') || buttonText.includes('agree'))) {
                                            await button.click();
                                            log.info(`✓ Clicked consent button: "${buttonText.trim()}"`);
                                            await randomDelay(2000, 3000);
                                            break;
                                        }
                                    }
                                } catch (e) {
                                    // Continue to next selector
                                }
                            }
                        }
                        
                        // Also try clicking by evaluating buttons with specific text
                        await page.evaluate(() => {
                            const buttons = Array.from(document.querySelectorAll('button'));
                            for (const btn of buttons) {
                                const text = btn.textContent?.toLowerCase() || '';
                                if (text.includes('accept all') || text.includes('reject all') || text.includes('i agree')) {
                                    btn.click();
                                    return true;
                                }
                            }
                            return false;
                        });
                        
                        await randomDelay(1000, 2000);
                    } catch (e) {
                        log.debug(`Cookie consent handling: ${e.message}`);
                    }
                    
                    // Wait for page to load - try multiple selectors
                    log.info('⏳ Waiting for search results to load...');
                    try {
                        await page.waitForSelector('[role="feed"], [aria-label*="Results"], div[role="article"]', { timeout: 30000 });
                    } catch (e) {
                        // If standard selectors fail, check what's actually on the page
                        const pageContent = await page.evaluate(() => {
                            return {
                                hasArticles: document.querySelectorAll('div[role="article"]').length,
                                hasLinks: document.querySelectorAll('a[href*="/maps/place/"]').length,
                                bodyText: document.body?.innerText?.substring(0, 500) || ''
                            };
                        });
                        log.info(`Page state: ${JSON.stringify(pageContent)}`);
                        
                        // If we have articles or place links, continue anyway
                        if (pageContent.hasArticles > 0 || pageContent.hasLinks > 0) {
                            log.info(`✓ Found ${pageContent.hasArticles} articles and ${pageContent.hasLinks} place links`);
                        } else {
                            throw new Error(`No results found. Page content: ${pageContent.bodyText}`);
                        }
                    }
                    await randomDelay(2000, 3000);

                    // Check if any filters are enabled
                    const filtersEnabled = skipSponsored || skipWithWebsite || skipWithPhone || skipWithoutContact;
                    
                    // Keep scrolling and extracting until we have enough filtered results
                    let reachedEnd = false;
                    let totalSkipped = 0;
                    
                    while (scrapedCount < maxResults && !reachedEnd) {
                        // Get current loaded count to calculate scroll target
                        const currentLoaded = await page.evaluate(() => {
                            const articles = document.querySelectorAll('div[role="article"]');
                            const links = document.querySelectorAll('a[href*="/maps/place/"]');
                            return Math.max(articles.length, links.length);
                        });
                        
                        // Scroll target = currently loaded + what we still need
                        // This ensures we always try to load MORE than what's visible
                        const stillNeeded = maxResults - scrapedCount;
                        const scrollTarget = currentLoaded + stillNeeded;
                        
                        // Scroll sidebar to load more results
                        const scrollResult = await scrollSidebar(page, scrollTarget);
                        reachedEnd = scrollResult.reachedEnd;
                        if (reachedEnd) {
                            log.info(`📜 Reached end of results (${scrollResult.resultsLoaded} total)`);
                        }

                        await randomDelay(2000, 3000);

                        // Extract all available businesses
                        const businesses = await extractBusinessListings(page, Infinity);

                        if (businesses.length === 0) {
                            log.warning('⚠️ No businesses found. Try adjusting your search query.');
                            break;
                        }

                        // Process businesses and apply filters
                        let skippedThisRound = 0;
                        for (const business of businesses) {
                            if (scrapedCount >= maxResults) break;

                            if (!scrapedUrls.has(business.url)) {
                                // Apply filtering - skip listings based on filter settings
                                // These skipped listings do NOT count towards maxResults
                                if (skipSponsored && business.isSponsored) {
                                    log.debug(`Skipping ${business.name} - sponsored listing`);
                                    skippedThisRound++;
                                    scrapedUrls.add(business.url); // Mark as seen so we don't process again
                                    continue;
                                }
                                if (skipWithWebsite && business.website) {
                                    log.debug(`Skipping ${business.name} - has website: ${business.website}`);
                                    skippedThisRound++;
                                    scrapedUrls.add(business.url);
                                    continue;
                                }
                                if (skipWithPhone && business.phone) {
                                    log.debug(`Skipping ${business.name} - has phone: ${business.phone}`);
                                    skippedThisRound++;
                                    scrapedUrls.add(business.url);
                                    continue;
                                }
                                if (skipWithoutContact && !business.phone && !business.email) {
                                    log.debug(`Skipping ${business.name} - no contact info (no phone or email)`);
                                    skippedThisRound++;
                                    scrapedUrls.add(business.url);
                                    continue;
                                }

                                scrapedUrls.add(business.url);
                                scrapedCount++;

                                if (scrapeDetails) {
                                    // Add business detail page to queue
                                    await crawler.addRequests([{
                                        url: business.url,
                                        userData: { business }
                                    }]);
                                } else {
                                    // Clean data types before saving
                                    const cleanBusiness = {
                                        name: String(business.name || 'Unknown'),
                                        url: String(business.url || ''),
                                        rating: business.rating !== null ? Number(business.rating) : null,
                                        reviewCount: business.reviewCount !== null ? parseInt(business.reviewCount) : null,
                                        category: business.category || null,
                                        address: business.address || null,
                                        phone: business.phone || null,
                                        website: business.website || null,
                                        hoursStatus: business.hoursStatus || null,
                                        isSponsored: Boolean(business.isSponsored),
                                        scrapedAt: business.scrapedAt || new Date().toISOString()
                                    };
                                    await Dataset.pushData(cleanBusiness);
                                }
                            }
                        }
                        
                        totalSkipped += skippedThisRound;
                        log.info(`✓ Progress: ${scrapedCount}/${isUnlimited ? '∞' : maxResults} collected${totalSkipped > 0 ? `, ${totalSkipped} skipped by filters` : ''}`);
                        
                        // If we haven't found enough and haven't reached the end, continue scrolling
                        if (scrapedCount < maxResults && !reachedEnd) {
                            log.info(`📜 Scrolling to find more results...`);
                        }
                    }

                } catch (error) {
                    log.error(`Error processing search page: ${error.message}`);
                    
                    // Capture screenshot for debugging if enabled
                    if (debugScreenshots) {
                        await captureDebugScreenshot(page, Actor, log, 'error');
                    }
                    
                    throw error;
                }
            }
        },

        async failedRequestHandler({ request, log }, error) {
            log.error(`Request ${request.url} failed after retries: ${error.message}`);
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
