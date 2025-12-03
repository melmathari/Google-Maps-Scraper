import { randomDelay } from './utils.js';

/**
 * Extract reviews for a business by clicking on its listing to open the sidebar
 * @param {Object} page - Puppeteer page
 * @param {Object} business - Business object with url and name
 * @param {number} maxReviews - Maximum reviews to extract (0 or Infinity for unlimited)
 * @param {boolean} extractShareLinks - Whether to extract share links for reviews
 * @param {Object} log - Logger instance
 * @returns {Array} Array of review objects
 */
export async function extractReviewsFromListing(page, business, maxReviews, extractShareLinks = false, log = console) {
    const isUnlimited = maxReviews === 0 || maxReviews === Infinity || maxReviews === null || maxReviews === undefined;
    const targetReviews = isUnlimited ? Infinity : maxReviews;
    
    try {
        // Click on the listing to open the sidebar
        const clicked = await clickOnListing(page, business, log);
        if (!clicked) {
            log.warning(`Could not click on listing for: ${business.name}`);
            return [];
        }
        
        await randomDelay(2000, 3000);
        
        // Wait for the sidebar to load
        await waitForSidebar(page, log);
        
        // Click on Reviews tab to open reviews panel
        const reviewsOpened = await clickReviewsTab(page, log);
        if (!reviewsOpened) {
            log.warning(`Could not open reviews tab for: ${business.name}`);
            await closeSidebar(page, log);
            return [];
        }
        await randomDelay(2000, 3000);
        
        // Scroll to load more reviews
        log.info(`📜 Loading reviews (target: ${isUnlimited ? 'unlimited' : targetReviews})...`);
        await scrollReviewsPanel(page, targetReviews, log);
        
        // Extract reviews
        const reviews = await extractReviewsFromPage(page, targetReviews, log);
        log.info(`✓ Found ${reviews.length} reviews`);
        
        // Extract share links if requested
        if (extractShareLinks && reviews.length > 0) {
            log.info('🔗 Extracting share links...');
            await extractShareLinksForReviews(page, reviews, log);
        }
        
        // Close the sidebar/go back to listings
        await closeSidebar(page, log);
        await randomDelay(1000, 2000);
        
        return reviews;
        
    } catch (error) {
        log.error(`Error extracting reviews: ${error.message}`);
        // Try to close sidebar before returning
        try {
            await closeSidebar(page, log);
        } catch (e) {
            // Ignore close errors
        }
        return [];
    }
}

/**
 * Click on a listing in the search results to open its sidebar
 */
async function clickOnListing(page, business, log) {
    try {
        // First, ensure we're back on the listings view
        const onListingsPage = await page.evaluate(() => {
            const feed = document.querySelector('[role="feed"]');
            const articles = document.querySelectorAll('div[role="article"]');
            return feed || articles.length > 0;
        });
        
        if (!onListingsPage) {
            log.warning('Not on listings page, trying to navigate back...');
            await page.keyboard.press('Escape');
            await randomDelay(1000, 1500);
        }
        
        const clicked = await page.evaluate((businessUrl, businessName) => {
            const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normalizedName = normalize(businessName);
            
            const links = document.querySelectorAll('a[href*="/maps/place/"]');
            for (const link of links) {
                if (link.href === businessUrl) {
                    link.click();
                    return 'url-exact';
                }
            }
            
            for (const link of links) {
                const urlMatch = link.href.match(/\/maps\/place\/([^/]+)/);
                if (urlMatch) {
                    const urlPlaceName = normalize(decodeURIComponent(urlMatch[1]).replace(/\+/g, ' '));
                    if (urlPlaceName.includes(normalizedName) || normalizedName.includes(urlPlaceName)) {
                        link.click();
                        return 'url-partial';
                    }
                }
            }
            
            const articles = document.querySelectorAll('div[role="article"]');
            for (const article of articles) {
                const ariaLabel = article.getAttribute('aria-label') || '';
                if (normalize(ariaLabel).includes(normalizedName) || normalizedName.includes(normalize(ariaLabel))) {
                    const link = article.querySelector('a[href*="/maps/place/"]');
                    if (link) {
                        link.click();
                        return 'article-aria';
                    }
                    article.click();
                    return 'article-click';
                }
            }
            
            for (const link of links) {
                const linkText = link.textContent || link.getAttribute('aria-label') || '';
                if (normalize(linkText).includes(normalizedName) || normalizedName.includes(normalize(linkText))) {
                    link.click();
                    return 'link-text';
                }
            }
            
            return false;
        }, business.url, business.name);
        
        if (clicked) {
            log.debug(`Clicked on listing using method: ${clicked}`);
        }
        
        return !!clicked;
    } catch (error) {
        log.warning(`Error clicking on listing: ${error.message}`);
        return false;
    }
}

/**
 * Wait for the business sidebar to load
 */
async function waitForSidebar(page, log) {
    try {
        await page.waitForFunction(() => {
            const h1 = document.querySelector('h1');
            const tabs = document.querySelectorAll('[role="tab"]');
            return h1 || tabs.length > 0;
        }, { timeout: 15000 });
    } catch (error) {
        log.warning(`Sidebar may not have loaded fully: ${error.message}`);
    }
}

/**
 * Click on the Reviews tab to open the reviews panel
 */
async function clickReviewsTab(page, log) {
    try {
        const clicked = await page.evaluate(() => {
            // Method 1: Find tab with role="tab" containing "Reviews"
            const tabs = document.querySelectorAll('[role="tab"]');
            for (const tab of tabs) {
                const ariaLabel = tab.getAttribute('aria-label') || '';
                const textContent = tab.textContent || '';
                if (ariaLabel.toLowerCase().includes('reviews') || textContent.toLowerCase().includes('reviews')) {
                    tab.click();
                    return 'tab-role';
                }
            }
            
            // Method 2: Look for buttons containing "Reviews"
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const textContent = btn.textContent || '';
                if (textContent.toLowerCase().includes('write')) continue;
                
                if (ariaLabel.toLowerCase().includes('reviews') || 
                    (textContent.toLowerCase().includes('reviews') && !textContent.toLowerCase().includes('more reviews'))) {
                    btn.click();
                    return 'button-reviews';
                }
            }
            
            // Method 3: Look for review count button (e.g., "333 reviews")
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const textContent = btn.textContent || '';
                if (/\d+\s*reviews?/i.test(ariaLabel) || /\d+\s*reviews?/i.test(textContent)) {
                    btn.click();
                    return 'review-count';
                }
            }
            
            return false;
        });
        
        if (clicked) {
            log.info(`✓ Opened reviews panel (method: ${clicked})`);
            await randomDelay(2000, 3000);
            return true;
        }
        
        log.warning('Could not find Reviews tab or button');
        return false;
    } catch (error) {
        log.warning(`Error clicking Reviews tab: ${error.message}`);
        return false;
    }
}

/**
 * Scroll the reviews panel to load more reviews
 */
async function scrollReviewsPanel(page, maxReviews, log) {
    const maxScrolls = Math.min(200, Math.max(5, Math.ceil(maxReviews / 3) + 10));
    let scrollCount = 0;
    let previousCount = 0;
    let noChangeCount = 0;
    
    while (scrollCount < maxScrolls) {
        // Count reviews by data-review-id attribute (the unique identifier)
        const currentCount = await page.evaluate(() => {
            // Each review container has data-review-id attribute
            const reviewContainers = document.querySelectorAll('div.jftiEf[data-review-id]');
            return reviewContainers.length;
        });
        
        if (currentCount >= maxReviews) {
            log.info(`📜 Loaded ${currentCount} reviews (target reached)`);
            return;
        }
        
        if (currentCount === previousCount) {
            noChangeCount++;
            if (noChangeCount >= 5) {
                log.info(`📜 No more reviews loading (${currentCount} total)`);
                return;
            }
        } else {
            noChangeCount = 0;
            previousCount = currentCount;
            log.debug(`📜 Loaded ${currentCount} reviews so far...`);
        }
        
        // Scroll the reviews container
        await page.evaluate(() => {
            const scrollableSelectors = [
                '[role="main"]',
                '.section-scrollbox',
                '[tabindex="-1"]',
            ];
            
            for (const selector of scrollableSelectors) {
                const container = document.querySelector(selector);
                if (container && container.scrollHeight > container.clientHeight) {
                    container.scrollTop = container.scrollHeight;
                    return true;
                }
            }
            
            const allDivs = document.querySelectorAll('div');
            for (const div of allDivs) {
                const style = window.getComputedStyle(div);
                const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
                                    div.scrollHeight > div.clientHeight;
                if (isScrollable && div.scrollHeight > 500) {
                    div.scrollTop = div.scrollHeight;
                    return true;
                }
            }
            
            return false;
        });
        
        await randomDelay(1500, 2500);
        scrollCount++;
    }
}

/**
 * Extract reviews from the current page using data-review-id as the anchor
 */
async function extractReviewsFromPage(page, maxReviews, log) {
    const reviews = await page.evaluate((max) => {
        const results = [];
        
        // Find all review containers by data-review-id attribute
        const reviewContainers = document.querySelectorAll('div.jftiEf[data-review-id]');
        
        for (const container of reviewContainers) {
            if (results.length >= max) break;
            
            try {
                const reviewId = container.getAttribute('data-review-id');
                
                // Reviewer name from aria-label of container or d4r55 class
                let reviewerName = container.getAttribute('aria-label') || '';
                if (!reviewerName) {
                    const nameEl = container.querySelector('.d4r55');
                    reviewerName = nameEl ? nameEl.textContent.trim() : 'Unknown';
                }
                
                // Reviewer subtitle (e.g., "Local Guide · 26 reviews · 3 photos")
                const subtitleEl = container.querySelector('.RfnDt');
                const reviewerSubtitle = subtitleEl ? subtitleEl.textContent.trim() : null;
                
                // Star rating from span with role="img" and aria-label containing "stars"
                let rating = null;
                const ratingEl = container.querySelector('span[role="img"][aria-label*="star"]');
                if (ratingEl) {
                    const ratingMatch = ratingEl.getAttribute('aria-label').match(/(\d+)\s*star/i);
                    if (ratingMatch) {
                        rating = parseInt(ratingMatch[1]);
                    }
                }
                
                // Review text from span.wiI7pd
                const textEl = container.querySelector('span.wiI7pd');
                const reviewText = textEl ? textEl.textContent.trim() : null;
                
                // Review date from span.rsqaWe
                const dateEl = container.querySelector('span.rsqaWe');
                const reviewDate = dateEl ? dateEl.textContent.trim() : null;
                
                // Like count from the Like button's aria-label
                let likesCount = null;
                const likeBtn = container.querySelector('button[aria-label*="like"]');
                if (likeBtn) {
                    const likeLabel = likeBtn.getAttribute('aria-label') || '';
                    const likesMatch = likeLabel.match(/(\d+)\s*like/i);
                    if (likesMatch) {
                        likesCount = parseInt(likesMatch[1]);
                    }
                }
                
                results.push({
                    reviewId,
                    reviewerName,
                    reviewerSubtitle,
                    rating,
                    reviewText,
                    reviewDate,
                    likesCount,
                    shareLink: null
                });
                
            } catch (error) {
                console.error('Error extracting review:', error.message);
            }
        }
        
        return results;
    }, maxReviews);
    
    return reviews;
}

/**
 * Extract share links for each review using their review ID
 */
async function extractShareLinksForReviews(page, reviews, log) {
    for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i];
        try {
            // Click the share button for this review using data-review-id
            const clicked = await page.evaluate((reviewId) => {
                // Find share button by data-review-id
                const shareBtn = document.querySelector(`button[data-review-id="${reviewId}"][aria-label*="Share"]`);
                if (shareBtn) {
                    shareBtn.click();
                    return true;
                }
                return false;
            }, review.reviewId);
            
            if (!clicked) continue;
            
            await randomDelay(1500, 2500);
            
            // Extract the share URL from the dialog
            const url = await page.evaluate(() => {
                const inputs = document.querySelectorAll('input[type="text"], input[readonly], [role="textbox"]');
                for (const input of inputs) {
                    const value = input.value || input.textContent || '';
                    if (value.includes('maps.app.goo.gl') || value.includes('goo.gl/maps') || value.includes('google.com/maps')) {
                        return value;
                    }
                }
                return null;
            });
            
            if (url) {
                review.shareLink = url;
                log.info(`  ✓ Got share link for ${review.reviewerName}`);
            }
            
            await closeShareDialog(page);
            await randomDelay(500, 1000);
            
        } catch (error) {
            log.warning(`  ✗ Failed to get share link for ${review.reviewerName}`);
            try {
                await closeShareDialog(page);
            } catch (e) {
                // Ignore
            }
        }
    }
}

/**
 * Close the share dialog
 */
async function closeShareDialog(page) {
    const closed = await page.evaluate(() => {
        const closeSelectors = [
            'button[aria-label="Close"]',
            'button[aria-label="close"]',
            '[role="dialog"] button[aria-label*="Close"]',
            '[role="dialog"] button[aria-label*="close"]'
        ];
        
        for (const selector of closeSelectors) {
            const btn = document.querySelector(selector);
            if (btn) {
                btn.click();
                return true;
            }
        }
        return false;
    });
    
    if (!closed) {
        await page.keyboard.press('Escape');
    }
    
    await randomDelay(300, 500);
}

/**
 * Close the sidebar and go back to the listing view
 */
async function closeSidebar(page, log) {
    try {
        await closeShareDialog(page);
        
        let closed = await page.evaluate(() => {
            const backSelectors = [
                'button[aria-label="Back"]',
                'button[aria-label="back"]', 
                'button[jsaction*="back"]',
                '[data-value="Back"]',
                '.section-back-to-list-button'
            ];
            
            for (const selector of backSelectors) {
                const btn = document.querySelector(selector);
                if (btn) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
        
        if (closed) {
            await randomDelay(1500, 2500);
            return;
        }
        
        await page.keyboard.press('Escape');
        await randomDelay(1000, 1500);
        
        const stillInDetail = await page.evaluate(() => {
            const h1 = document.querySelector('h1');
            const feed = document.querySelector('[role="feed"]');
            return h1 && !feed;
        });
        
        if (stillInDetail) {
            await page.keyboard.press('Escape');
            await randomDelay(1000, 1500);
            
            await page.evaluate(() => {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                    if (ariaLabel.includes('back') || ariaLabel.includes('close')) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            });
            await randomDelay(1000, 1500);
        }
        
        const backToListings = await page.evaluate(() => {
            const feed = document.querySelector('[role="feed"]');
            const articles = document.querySelectorAll('div[role="article"]');
            return feed || articles.length > 0;
        });
        
        if (!backToListings) {
            log.warning('May not have returned to listings view properly');
        }
        
    } catch (error) {
        log.warning(`Error closing sidebar: ${error.message}`);
    }
}
