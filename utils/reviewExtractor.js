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
        
        // Click on "More reviews" button to expand reviews panel
        await clickMoreReviewsButton(page, log);
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
 * @param {Object} page - Puppeteer page
 * @param {Object} business - Business object with url and name
 * @param {Object} log - Logger instance
 * @returns {boolean} Whether the click was successful
 */
async function clickOnListing(page, business, log) {
    try {
        const clicked = await page.evaluate((businessUrl, businessName) => {
            // Try to find the listing link by URL
            const links = document.querySelectorAll('a[href*="/maps/place/"]');
            for (const link of links) {
                if (link.href === businessUrl || link.href.includes(encodeURIComponent(businessName))) {
                    link.click();
                    return true;
                }
            }
            
            // Try to find by aria-label containing business name
            const articles = document.querySelectorAll('div[role="article"]');
            for (const article of articles) {
                const ariaLabel = article.getAttribute('aria-label') || '';
                if (ariaLabel.includes(businessName)) {
                    const link = article.querySelector('a[href*="/maps/place/"]');
                    if (link) {
                        link.click();
                        return true;
                    }
                }
            }
            
            return false;
        }, business.url, business.name);
        
        return clicked;
    } catch (error) {
        log.warning(`Error clicking on listing: ${error.message}`);
        return false;
    }
}

/**
 * Wait for the business sidebar to load
 * @param {Object} page - Puppeteer page
 * @param {Object} log - Logger instance
 */
async function waitForSidebar(page, log) {
    try {
        // Wait for the sidebar to appear with business details
        await page.waitForFunction(() => {
            // Look for h1 (business name) or reviews tab button
            const h1 = document.querySelector('h1');
            const reviewsTab = document.querySelector('button[aria-label*="Reviews"], [role="tab"][aria-label*="Reviews"]');
            return h1 || reviewsTab;
        }, { timeout: 15000 });
    } catch (error) {
        log.warning(`Sidebar may not have loaded fully: ${error.message}`);
    }
}

/**
 * Click on the "More reviews" button to open the full reviews panel
 * @param {Object} page - Puppeteer page
 * @param {Object} log - Logger instance
 * @returns {boolean} Whether the click was successful
 */
async function clickMoreReviewsButton(page, log) {
    try {
        const clicked = await page.evaluate(() => {
            // Look for "More reviews (X)" button
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const textContent = btn.textContent || '';
                if (ariaLabel.includes('More reviews') || textContent.includes('More reviews')) {
                    btn.click();
                    return true;
                }
            }
            
            // Also try clicking on the reviews tab
            const reviewsTab = document.querySelector('button[aria-label*="Reviews"], [role="tab"][aria-label*="Reviews"]');
            if (reviewsTab) {
                reviewsTab.click();
                return true;
            }
            
            return false;
        });
        
        if (clicked) {
            log.info('✓ Opened reviews panel');
            await randomDelay(2000, 3000);
        }
        
        return clicked;
    } catch (error) {
        log.warning(`Error clicking More reviews: ${error.message}`);
        return false;
    }
}

/**
 * Scroll the reviews panel to load more reviews
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Target number of reviews
 * @param {Object} log - Logger instance
 */
async function scrollReviewsPanel(page, maxReviews, log) {
    const maxScrolls = Math.min(200, Math.max(5, Math.ceil(maxReviews / 3) + 10));
    let scrollCount = 0;
    let previousCount = 0;
    let noChangeCount = 0;
    
    while (scrollCount < maxScrolls) {
        // Count current reviews
        const currentCount = await page.evaluate(() => {
            // Count reviews by share buttons (each review has one)
            const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
            return shareButtons.length;
        });
        
        if (currentCount >= maxReviews) {
            log.info(`📜 Loaded ${currentCount} reviews (target reached)`);
            return;
        }
        
        // Check if we're getting new reviews
        if (currentCount === previousCount) {
            noChangeCount++;
            if (noChangeCount >= 5) {
                log.info(`📜 No more reviews loading (${currentCount} total)`);
                return;
            }
        } else {
            noChangeCount = 0;
            previousCount = currentCount;
        }
        
        // Scroll the reviews container
        await page.evaluate(() => {
            // Find the scrollable container for reviews
            const containers = [
                document.querySelector('[role="main"]'),
                document.querySelector('.section-scrollbox'),
                document.querySelector('[data-tab-index="1"]'),
            ];
            
            for (const container of containers) {
                if (container && container.scrollHeight > container.clientHeight) {
                    container.scrollTop = container.scrollHeight;
                    return;
                }
            }
            
            // Fallback: try scrolling any scrollable div
            const scrollables = document.querySelectorAll('div[style*="overflow"]');
            for (const el of scrollables) {
                if (el.scrollHeight > el.clientHeight) {
                    el.scrollTop = el.scrollHeight;
                    return;
                }
            }
        });
        
        await randomDelay(1500, 2500);
        scrollCount++;
    }
}

/**
 * Extract reviews from the current page
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews to extract
 * @param {Object} log - Logger instance
 * @returns {Array} Array of review objects
 */
async function extractReviewsFromPage(page, maxReviews, log) {
    const reviews = await page.evaluate((max) => {
        const results = [];
        
        // Find all share buttons for reviews (each review has one)
        const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
        
        for (const shareBtn of shareButtons) {
            if (results.length >= max) break;
            
            try {
                // Get reviewer name from share button label: "Share [Name]'s review"
                const shareBtnLabel = shareBtn.getAttribute('aria-label') || '';
                const nameMatch = shareBtnLabel.match(/Share\s+(.+?)['']s\s+review/i);
                if (!nameMatch) continue;
                
                const reviewerName = nameMatch[1].trim();
                
                // Find the parent review container by walking up the DOM
                let reviewContainer = shareBtn;
                for (let i = 0; i < 10 && reviewContainer; i++) {
                    reviewContainer = reviewContainer.parentElement;
                    const name = reviewContainer?.getAttribute('aria-label');
                    if (name && name.toLowerCase().includes(reviewerName.toLowerCase())) {
                        break;
                    }
                }
                
                if (!reviewContainer) {
                    reviewContainer = shareBtn.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
                }
                
                // Extract reviewer subtitle (e.g., "Local Guide · 26 reviews · 3 photos")
                let reviewerSubtitle = null;
                const buttons = reviewContainer?.querySelectorAll('button') || [];
                for (const btn of buttons) {
                    const label = btn.getAttribute('aria-label') || '';
                    // Look for button with reviewer info pattern
                    if (label.includes('review') && !label.includes('Actions') && !label.includes('Share') && !label.includes('Photo')) {
                        // Extract everything after the name
                        const subtitleParts = label.split(/Local Guide|·/i);
                        if (subtitleParts.length > 1) {
                            // Reconstruct subtitle from parts after name
                            const nameEndIdx = label.toLowerCase().indexOf(reviewerName.toLowerCase()) + reviewerName.length;
                            reviewerSubtitle = label.substring(nameEndIdx).trim().replace(/^[·\s]+/, '');
                        }
                        break;
                    }
                }
                
                // Extract rating from img with "X stars" aria-label
                let rating = null;
                const ratingImgs = reviewContainer?.querySelectorAll('img[aria-label*="star"], [role="img"][aria-label*="star"]') || [];
                for (const img of ratingImgs) {
                    const label = img.getAttribute('aria-label') || '';
                    const ratingMatch = label.match(/(\d+)\s*star/i);
                    if (ratingMatch) {
                        rating = parseInt(ratingMatch[1]);
                        break;
                    }
                }
                
                // Extract review text
                // The text is usually in a span with the actual review content
                let reviewText = null;
                const textElements = reviewContainer?.querySelectorAll('span.wiI7pd, span[data-expandable-section], span.MyEned') || [];
                for (const el of textElements) {
                    const text = el.textContent?.trim();
                    if (text && text.length > 10) {
                        reviewText = text;
                        break;
                    }
                }
                
                // Fallback: look for longest text span
                if (!reviewText) {
                    const allSpans = reviewContainer?.querySelectorAll('span') || [];
                    let longestText = '';
                    for (const span of allSpans) {
                        const text = span.textContent?.trim() || '';
                        // Skip short texts and UI elements
                        if (text.length > 30 && 
                            text.length > longestText.length &&
                            !text.includes('Local Guide') &&
                            !text.match(/^\d+\s*(review|photo|like)/i)) {
                            longestText = text;
                        }
                    }
                    if (longestText) {
                        reviewText = longestText;
                    }
                }
                
                // Extract likes count
                let likesCount = null;
                for (const btn of buttons) {
                    const label = btn.getAttribute('aria-label') || btn.textContent || '';
                    const likesMatch = label.match(/(\d+)\s*like/i);
                    if (likesMatch) {
                        likesCount = parseInt(likesMatch[1]);
                        break;
                    }
                }
                
                // Extract review date (e.g., "2 months ago")
                let reviewDate = null;
                const dateSpans = reviewContainer?.querySelectorAll('span.rsqaWe, span[class*="date"]') || [];
                for (const span of dateSpans) {
                    const text = span.textContent?.trim() || '';
                    if (text.match(/\d+\s*(day|week|month|year|hour|minute)s?\s*ago/i) || 
                        text.match(/^(a|an)\s+(day|week|month|year|hour|minute)\s*ago/i)) {
                        reviewDate = text;
                        break;
                    }
                }
                
                results.push({
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
 * Extract share links for each review
 * @param {Object} page - Puppeteer page
 * @param {Array} reviews - Array of review objects to update
 * @param {Object} log - Logger instance
 */
async function extractShareLinksForReviews(page, reviews, log) {
    for (let i = 0; i < reviews.length; i++) {
        const review = reviews[i];
        try {
            // Click the share button for this review
            const shareUrl = await page.evaluate(async (reviewerName) => {
                // Find the share button for this reviewer
                const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
                for (const btn of shareButtons) {
                    const label = btn.getAttribute('aria-label') || '';
                    if (label.toLowerCase().includes(reviewerName.toLowerCase())) {
                        btn.click();
                        return true;
                    }
                }
                return false;
            }, review.reviewerName);
            
            if (!shareUrl) continue;
            
            await randomDelay(1500, 2500);
            
            // Extract the share URL from the dialog
            const url = await page.evaluate(() => {
                // Look for the textbox with the share URL
                const textboxes = document.querySelectorAll('input[type="text"], [role="textbox"]');
                for (const input of textboxes) {
                    const value = input.value || input.getAttribute('aria-label') || '';
                    if (value.includes('maps.app.goo.gl') || value.includes('goo.gl/maps')) {
                        return value;
                    }
                }
                return null;
            });
            
            if (url) {
                review.shareLink = url;
                log.info(`  ✓ Got share link for ${review.reviewerName}`);
            }
            
            // Close the share dialog
            await page.evaluate(() => {
                const closeBtn = document.querySelector('button[aria-label="Close"]');
                if (closeBtn) {
                    closeBtn.click();
                }
            });
            
            await randomDelay(500, 1000);
            
        } catch (error) {
            log.warning(`  ✗ Failed to get share link for ${review.reviewerName}`);
        }
    }
}

/**
 * Close the sidebar and go back to the listing view
 * @param {Object} page - Puppeteer page
 * @param {Object} log - Logger instance
 */
async function closeSidebar(page, log) {
    try {
        // Try clicking the back button or close button
        await page.evaluate(() => {
            // Look for back arrow button
            const backBtn = document.querySelector('button[aria-label="Back"], button[aria-label*="back"]');
            if (backBtn) {
                backBtn.click();
                return true;
            }
            
            // Look for close button
            const closeBtn = document.querySelector('button[aria-label="Close"]');
            if (closeBtn) {
                closeBtn.click();
                return true;
            }
            
            return false;
        });
        
        await randomDelay(1000, 2000);
        
        // If still in detail view, try pressing Escape
        const stillInDetail = await page.evaluate(() => {
            return !!document.querySelector('h1');
        });
        
        if (stillInDetail) {
            await page.keyboard.press('Escape');
            await randomDelay(1000, 1500);
        }
        
    } catch (error) {
        log.warning(`Error closing sidebar: ${error.message}`);
    }
}
