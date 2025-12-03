import { randomDelay } from './utils.js';

/**
 * Scroll the reviews panel to load more reviews
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews needed
 * @returns {Object} - Scroll count and whether end was reached
 */
async function scrollReviewsPanel(page, maxReviews) {
    const maxScrolls = Math.min(300, Math.max(5, Math.ceil(maxReviews / 5) + 10));
    
    let scrollCount = 0;
    let previousHeight = 0;
    let noChangeCount = 0;

    while (scrollCount < maxScrolls) {
        // Check how many reviews we currently have loaded
        const currentReviewCount = await page.evaluate(() => {
            // Reviews are in generic elements that contain share buttons for reviews
            const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
            return shareButtons.length;
        });

        // If we have enough reviews, stop scrolling early
        if (currentReviewCount >= maxReviews) {
            return { scrollCount, reachedEnd: false, reviewsLoaded: currentReviewCount };
        }

        // Scroll the reviews panel
        const scrollResult = await page.evaluate(() => {
            // Find the scrollable reviews container
            // It's usually a div with role="main" or the reviews tab panel
            const scrollableContainers = [
                document.querySelector('[role="main"]'),
                document.querySelector('[data-tab-index="1"]'), // Reviews tab content
                document.querySelector('.section-scrollbox'),
                document.querySelector('[aria-label*="Reviews"]'),
            ];
            
            for (const container of scrollableContainers) {
                if (container && container.scrollHeight > container.clientHeight) {
                    container.scrollTop = container.scrollHeight;
                    return { height: container.scrollHeight, found: true };
                }
            }
            
            // Fallback: scroll the whole document
            window.scrollTo(0, document.body.scrollHeight);
            return { height: document.body.scrollHeight, found: false };
        });

        await randomDelay(1500, 2500);

        // Check for "end of reviews" or loading indicators
        const reachedEnd = await page.evaluate(() => {
            const pageText = document.body.innerText || '';
            // Check if we've loaded all reviews or there's no more content
            return pageText.includes("No more reviews") ||
                   pageText.includes("End of reviews");
        });

        if (reachedEnd) {
            const finalCount = await page.evaluate(() => {
                const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
                return shareButtons.length;
            });
            return { scrollCount, reachedEnd: true, reviewsLoaded: finalCount };
        }

        // Check if height changed
        if (scrollResult.height === previousHeight || scrollResult.height === 0) {
            noChangeCount++;
            if (noChangeCount >= 5) {
                const finalCount = await page.evaluate(() => {
                    const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
                    return shareButtons.length;
                });
                return { scrollCount, reachedEnd: true, reviewsLoaded: finalCount };
            }
            await randomDelay(2000, 3000);
        } else {
            noChangeCount = 0;
        }

        previousHeight = scrollResult.height;
        scrollCount++;
    }

    const finalCount = await page.evaluate(() => {
        const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
        return shareButtons.length;
    });
    return { scrollCount, reachedEnd: false, reviewsLoaded: finalCount };
}

/**
 * Click on the "More reviews" button to open the reviews panel
 * @param {Object} page - Puppeteer page
 * @returns {boolean} - Whether the click was successful
 */
async function clickMoreReviewsButton(page) {
    try {
        // Look for the "More reviews (X)" button
        const clicked = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const textContent = btn.textContent || '';
                if (ariaLabel.includes('More reviews') || textContent.includes('More reviews')) {
                    btn.click();
                    return true;
                }
            }
            return false;
        });
        
        if (clicked) {
            await randomDelay(2000, 3000);
        }
        return clicked;
    } catch (error) {
        console.error('Error clicking More reviews button:', error.message);
        return false;
    }
}

/**
 * Extract reviews from the current page/panel
 * @param {Object} page - Puppeteer page
 * @param {number} maxReviews - Maximum reviews to extract
 * @param {boolean} extractShareLinks - Whether to extract share links
 * @param {Object} log - Logger instance
 * @returns {Array} Array of review objects
 */
export async function extractReviews(page, maxReviews, extractShareLinks = false, log = console) {
    log.info('📝 Starting review extraction...');
    
    // First, try to click "More reviews" button to open reviews panel
    const moreReviewsClicked = await clickMoreReviewsButton(page);
    if (moreReviewsClicked) {
        log.info('✓ Opened reviews panel');
    }
    
    await randomDelay(2000, 3000);
    
    // Scroll to load more reviews
    const isUnlimited = maxReviews === 0 || maxReviews === Infinity || maxReviews === null || maxReviews === undefined;
    const targetReviews = isUnlimited ? Infinity : maxReviews;
    
    log.info(`📜 Scrolling to load reviews (target: ${isUnlimited ? 'unlimited' : targetReviews})...`);
    const scrollResult = await scrollReviewsPanel(page, targetReviews);
    log.info(`📜 Loaded ${scrollResult.reviewsLoaded} reviews after ${scrollResult.scrollCount} scrolls`);
    
    // Extract review data
    const reviews = await page.evaluate((maxCount) => {
        const results = [];
        
        // Find all review containers
        // Each review has a "Share [name]'s review" button that identifies it
        const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
        
        for (const shareBtn of shareButtons) {
            if (results.length >= maxCount) break;
            
            try {
                // Find the parent review container
                // Walk up the DOM to find the review container (usually 4-6 levels up)
                let reviewContainer = shareBtn.closest('[data-review-id]') || 
                                     shareBtn.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
                
                if (!reviewContainer) {
                    // Alternative: look for parent with a name attribute that has the reviewer name
                    let parent = shareBtn.parentElement;
                    for (let i = 0; i < 10 && parent; i++) {
                        const name = parent.getAttribute('aria-label') || parent.getAttribute('data-name');
                        if (name) {
                            reviewContainer = parent;
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }
                
                if (!reviewContainer) reviewContainer = shareBtn.parentElement?.parentElement?.parentElement?.parentElement;
                
                // Extract reviewer name from share button label
                // Format: "Share [Name]'s review." or "Share [Name]'s review"
                const shareBtnLabel = shareBtn.getAttribute('aria-label') || '';
                let reviewerName = null;
                const nameMatch = shareBtnLabel.match(/Share\s+(.+?)['']s\s+review/i);
                if (nameMatch) {
                    reviewerName = nameMatch[1].trim();
                }
                
                if (!reviewerName && reviewContainer) {
                    // Try to get name from container's aria-label or name attribute
                    reviewerName = reviewContainer.getAttribute('aria-label') || 
                                  reviewContainer.getAttribute('data-name');
                }
                
                if (!reviewerName) {
                    // Look for name in buttons within the container
                    const nameButtons = reviewContainer?.querySelectorAll('button') || [];
                    for (const btn of nameButtons) {
                        const label = btn.getAttribute('aria-label') || '';
                        // Pattern: "Name Local Guide · X reviews" or "Name X reviews"
                        if (label.includes('review') && !label.includes('Actions') && !label.includes('Share')) {
                            // Extract just the name part
                            const parts = label.split(/Local Guide|·|\d+\s*review/i);
                            if (parts[0]) {
                                reviewerName = parts[0].trim();
                                break;
                            }
                        }
                    }
                }
                
                if (!reviewerName) continue;
                
                // Extract reviewer subtitle (e.g., "Local Guide · 26 reviews · 3 photos")
                let reviewerSubtitle = null;
                const reviewerButtons = reviewContainer?.querySelectorAll('button') || [];
                for (const btn of reviewerButtons) {
                    const label = btn.getAttribute('aria-label') || '';
                    // Look for button with full reviewer info
                    if (label.includes('review') && !label.includes('Actions') && !label.includes('Share') && !label.includes('Photo')) {
                        // This button has the full info like "Name Local Guide · X reviews · Y photos"
                        // Extract subtitle part (everything after the name)
                        const subtitleMatch = label.match(/^[^·]+?(?=Local Guide|·|\d+\s*review)/i);
                        if (subtitleMatch) {
                            const nameOnly = subtitleMatch[0].trim();
                            reviewerSubtitle = label.replace(nameOnly, '').trim();
                            // Clean up leading separators
                            reviewerSubtitle = reviewerSubtitle.replace(/^[·\s]+/, '').trim();
                        } else if (label.includes('·')) {
                            // Just extract from first · onwards
                            const idx = label.indexOf('·');
                            if (idx > 0) {
                                reviewerSubtitle = label.substring(idx + 1).trim();
                            }
                        }
                        break;
                    }
                }
                
                // Extract rating
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
                // The review text is usually in a span or div without specific aria-labels
                let reviewText = null;
                const textElements = reviewContainer?.querySelectorAll('span, div') || [];
                for (const el of textElements) {
                    // Skip elements that are part of known UI elements
                    const text = el.textContent?.trim() || '';
                    if (text.length > 20 && text.length < 5000 &&
                        !text.includes('review') &&
                        !text.includes('photo') &&
                        !text.includes('Local Guide') &&
                        !text.includes('Like') &&
                        !text.includes('Share') &&
                        !text.includes('star') &&
                        !text.match(/^\d+\s*(like|photo)/i)) {
                        // Check if this element doesn't contain other significant child elements
                        const childButtons = el.querySelectorAll('button, a, img');
                        if (childButtons.length === 0 || text.length > 50) {
                            reviewText = text;
                            break;
                        }
                    }
                }
                
                // Extract likes count
                let likesCount = null;
                const likeButtons = reviewContainer?.querySelectorAll('button') || [];
                for (const btn of likeButtons) {
                    const label = btn.getAttribute('aria-label') || btn.textContent || '';
                    const likesMatch = label.match(/(\d+)\s*like/i);
                    if (likesMatch) {
                        likesCount = parseInt(likesMatch[1]);
                        break;
                    }
                }
                
                // Store the share button reference for later share link extraction
                const shareBtnIndex = Array.from(document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]')).indexOf(shareBtn);
                
                results.push({
                    reviewerName,
                    reviewerSubtitle,
                    rating,
                    reviewText,
                    reviewDate: null, // Will try to extract separately if needed
                    likesCount,
                    shareLink: null, // Will be filled in if extractShareLinks is true
                    _shareBtnIndex: shareBtnIndex // Internal reference for share link extraction
                });
                
            } catch (error) {
                console.error('Error extracting review:', error.message);
            }
        }
        
        return results;
    }, isUnlimited ? Infinity : maxReviews);
    
    log.info(`✓ Extracted ${reviews.length} reviews`);
    
    // Extract share links if requested
    if (extractShareLinks && reviews.length > 0) {
        log.info('🔗 Extracting share links for reviews...');
        for (let i = 0; i < reviews.length; i++) {
            const review = reviews[i];
            try {
                const shareLink = await extractReviewShareLink(page, review._shareBtnIndex, log);
                if (shareLink) {
                    review.shareLink = shareLink;
                    log.info(`  ✓ Got share link for ${review.reviewerName}`);
                }
            } catch (error) {
                log.warning(`  ✗ Failed to get share link for ${review.reviewerName}: ${error.message}`);
            }
            
            // Clean up internal property
            delete review._shareBtnIndex;
            
            // Small delay between share link extractions
            if (i < reviews.length - 1) {
                await randomDelay(500, 1000);
            }
        }
    } else {
        // Clean up internal properties
        reviews.forEach(r => delete r._shareBtnIndex);
    }
    
    return reviews;
}

/**
 * Extract the share link for a specific review
 * @param {Object} page - Puppeteer page
 * @param {number} shareBtnIndex - Index of the share button to click
 * @param {Object} log - Logger instance
 * @returns {string|null} The share link URL or null
 */
async function extractReviewShareLink(page, shareBtnIndex, log) {
    try {
        // Click the share button
        const clicked = await page.evaluate((index) => {
            const shareButtons = document.querySelectorAll('button[aria-label*="Share"][aria-label*="review"]');
            if (index >= 0 && index < shareButtons.length) {
                shareButtons[index].click();
                return true;
            }
            return false;
        }, shareBtnIndex);
        
        if (!clicked) {
            return null;
        }
        
        await randomDelay(1000, 2000);
        
        // Look for the share dialog and extract the URL
        const shareUrl = await page.evaluate(() => {
            // Find the textbox with the share URL
            // It's usually in a dialog with "Send a link" tab
            const textboxes = document.querySelectorAll('input[type="text"], input[type="url"], [role="textbox"]');
            for (const input of textboxes) {
                const value = input.value || input.getAttribute('aria-label') || input.textContent || '';
                if (value.includes('maps.app.goo.gl') || value.includes('goo.gl/maps')) {
                    return value;
                }
            }
            
            // Also check aria-label which might contain the URL
            for (const input of textboxes) {
                const label = input.getAttribute('aria-label') || '';
                if (label.includes('maps.app.goo.gl') || label.includes('goo.gl/maps')) {
                    return label;
                }
            }
            
            return null;
        });
        
        // Close the share dialog
        await page.evaluate(() => {
            const closeButtons = document.querySelectorAll('button[aria-label="Close"], button[aria-label="close"]');
            for (const btn of closeButtons) {
                btn.click();
                return true;
            }
            // Fallback: press Escape
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
        });
        
        await randomDelay(500, 1000);
        
        return shareUrl;
    } catch (error) {
        log.warning(`Error extracting share link: ${error.message}`);
        return null;
    }
}

