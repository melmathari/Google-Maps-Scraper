/**
 * Extract business listings from Google Maps search results
 * @param {Object} page - Puppeteer page
 * @param {number} maxResults - Maximum results to extract
 * @returns {Array} Array of business objects
 */
export async function extractBusinessListings(page, maxResults) {
    console.log('📊 Extracting business listings from Google Maps...');

    const businesses = await page.evaluate((max) => {
        const results = [];
        const seenUrls = new Set();

        // Helper function to check if text looks like a category
        function isCategory(text) {
            if (!text || text.length < 3 || text.length > 60) return false;
            
            // Skip specific non-category patterns
            const skipPatterns = [
                /^sponsored$/i,
                /^\d/,                          // Starts with number
                /^\(/,                          // Starts with parenthesis
                /^open/i,                       // Open status
                /^closed/i,                     // Closed status
                /^opens/i,                      // Opens at
                /^closes/i,                     // Closes at
                /^\$+$/,                        // Price level
                /^website$/i,
                /^directions$/i,
                /^reviews?$/i,
                /^\d+\s*reviews?/i,
                /^share$/i,
                /^save$/i,
                /^more info$/i,
            ];
            
            for (const pattern of skipPatterns) {
                if (pattern.test(text)) return false;
            }
            
            // Category patterns - common business types
            const categoryPatterns = [
                /service/i,
                /cleaning/i,
                /restaurant/i,
                /cafe/i,
                /shop/i,
                /store/i,
                /salon/i,
                /hotel/i,
                /bar$/i,
                /club/i,
                /gym/i,
                /spa$/i,
                /clinic/i,
                /hospital/i,
                /school/i,
                /bank/i,
                /agency/i,
                /office/i,
                /center/i,
                /centre/i,
                /company/i,
                /contractor/i,
                /plumber/i,
                /electrician/i,
                /mechanic/i,
                /repair/i,
                /rental/i,
                /dealer/i,
                /supplier/i,
                /market/i,
                /bakery/i,
                /pharmacy/i,
                /dentist/i,
                /doctor/i,
                /lawyer/i,
                /attorney/i,
                /accountant/i,
                /consultant/i,
                /cleaners/i,
            ];
            
            for (const pattern of categoryPatterns) {
                if (pattern.test(text)) return true;
            }
            
            // Also accept capitalized multi-word phrases that look like categories
            if (/^[A-Z][a-z]+(\s+[a-z]+)*$/.test(text) && text.split(' ').length <= 4) {
                return true;
            }
            
            return false;
        }

        // Helper function to check if text looks like an address
        function isAddress(text) {
            if (!text || text.length < 5 || text.length > 150) return false;
            
            // Address patterns - contains street number, street name, or city indicators
            const addressPatterns = [
                /^\d+\s+[A-Za-z]/,              // Starts with number followed by letter (street address)
                /\d+[A-Za-z]?\s+[A-Za-z]/,      // Number with optional letter then street name
                /straat/i,                       // Dutch: street
                /weg$/i,                         // Dutch: way/road
                /laan$/i,                        // Dutch: lane
                /plein/i,                        // Dutch: square
                /gracht/i,                       // Dutch: canal
                /kade/i,                         // Dutch: quay
                /street/i,
                /road/i,
                /avenue/i,
                /drive/i,
                /boulevard/i,
                /lane/i,
                /place/i,
                /court/i,
                /square/i,
                /,\s*[A-Z][a-z]+/,              // Comma followed by city name
            ];
            
            for (const pattern of addressPatterns) {
                if (pattern.test(text)) return true;
            }
            
            return false;
        }

        // Helper function to check if text looks like a phone number
        function isPhoneNumber(text) {
            if (!text) return false;
            // Clean up the text
            const cleaned = text.replace(/[\s\-\.\(\)]/g, '');
            // Check if it's mostly digits (at least 7 digits for a valid phone)
            const digitCount = (cleaned.match(/\d/g) || []).length;
            return digitCount >= 7 && digitCount <= 15 && /^[\d\+\-\.\s\(\)]+$/.test(text.trim());
        }

        // Helper function to check if text is hours status
        function isHoursStatus(text) {
            if (!text) return false;
            return /^(open|closed|opens|closes)/i.test(text.trim());
        }

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

                // Initialize data fields
                let rating = null;
                let reviewCount = null;
                let category = null;
                let address = null;
                let phone = null;
                let website = null;
                let hoursStatus = null;
                let isSponsored = false;

                // Get all text content for analysis
                const textContent = article.textContent || '';
                
                // Check if this is a sponsored result
                if (textContent.toLowerCase().includes('sponsored')) {
                    isSponsored = true;
                }
                
                // Match rating pattern: number followed by stars or parentheses
                const ratingMatch = textContent.match(/(\d+\.?\d*)\s*(?:stars?|\()/i);
                if (ratingMatch) {
                    const ratingValue = parseFloat(ratingMatch[1]);
                    if (ratingValue >= 1 && ratingValue <= 5) {
                        rating = ratingValue;
                    }
                }
                
                // Match review count in parentheses: (119) or (1,234)
                const reviewMatch = textContent.match(/\(([0-9,]+)\)/);
                if (reviewMatch) {
                    reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
                }

                // Extract website URL from Website button/link
                // Google Maps has action buttons in various containers
                // Note: Sponsored listings use google.com/aclk tracking URLs that redirect to the actual website
                
                // Helper to check if URL is a valid website (including Google ad tracking URLs)
                function isValidWebsiteUrl(href) {
                    if (!href) return false;
                    // Allow Google ad click tracking URLs (they redirect to real websites)
                    if (href.includes('google.com/aclk')) return true;
                    // Block other Google/Maps URLs
                    if (href.includes('google.com') || href.includes('/maps/')) return false;
                    // Must be http/https
                    return href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//');
                }
                
                // Method 1: Direct selector for common patterns
                const websiteBtn = article.querySelector('a[data-value="Website"], a[aria-label*="Website"], a[data-tooltip*="website" i]');
                if (websiteBtn) {
                    const href = websiteBtn.href || websiteBtn.getAttribute('href');
                    if (isValidWebsiteUrl(href)) {
                        website = href.startsWith('//') ? 'https:' + href : href;
                    }
                }
                
                // Method 2: Look for action buttons container and find external links
                // Action buttons are often in a container with multiple <a> or <button> elements
                if (!website) {
                    // Find all link containers (divs that contain multiple action links)
                    const actionContainers = article.querySelectorAll('div');
                    for (const container of actionContainers) {
                        const links = container.querySelectorAll('a[href]');
                        // Action button containers typically have 2-5 links (Directions, Website, Call, etc.)
                        if (links.length >= 2 && links.length <= 6) {
                            for (const a of links) {
                                const href = a.href || a.getAttribute('href');
                                if (!href || href.startsWith('javascript:') || href === '#') continue;
                                
                                // Check if it's a valid website URL
                                if (isValidWebsiteUrl(href)) {
                                    // Skip social media links (but allow aclk tracking URLs)
                                    if (!href.includes('google.com/aclk') && 
                                        (href.includes('facebook.com') || href.includes('instagram.com') || 
                                         href.includes('twitter.com') || href.includes('youtube.com') ||
                                         href.includes('linkedin.com'))) continue;
                                    
                                    website = href.startsWith('//') ? 'https:' + href : href;
                                    break;
                                }
                            }
                            if (website) break;
                        }
                    }
                }
                
                // Method 3: Look through all links for website indicators in attributes
                if (!website) {
                    const allLinks = article.querySelectorAll('a[href]');
                    for (const a of allLinks) {
                        const href = a.href || a.getAttribute('href');
                        if (!isValidWebsiteUrl(href)) continue;
                        
                        const ariaLabel = (a.getAttribute('aria-label') || '').toLowerCase();
                        const dataValue = (a.getAttribute('data-value') || '').toLowerCase();
                        const dataTooltip = (a.getAttribute('data-tooltip') || '').toLowerCase();
                        const title = (a.getAttribute('title') || '').toLowerCase();
                        
                        // Check various attributes for "website" indicator
                        if (ariaLabel.includes('website') || 
                            dataValue === 'website' || 
                            dataTooltip.includes('website') ||
                            title.includes('website')) {
                            website = href.startsWith('//') ? 'https:' + href : href;
                            break;
                        }
                    }
                }
                
                // Method 4: Find any external link that looks like a business website
                if (!website) {
                    const allLinks = article.querySelectorAll('a[href]');
                    const externalLinks = [];
                    
                    for (const a of allLinks) {
                        const href = a.href || a.getAttribute('href');
                        if (!href || href.startsWith('javascript:') || href === '#') continue;
                        
                        // Check if it's a valid website URL
                        if (isValidWebsiteUrl(href)) {
                            // Skip social media (but allow aclk tracking URLs)
                            if (!href.includes('google.com/aclk') &&
                                (href.includes('facebook.com') || href.includes('instagram.com') || 
                                 href.includes('twitter.com') || href.includes('youtube.com') ||
                                 href.includes('linkedin.com') || href.includes('tiktok.com'))) continue;
                            
                            externalLinks.push(href.startsWith('//') ? 'https:' + href : href);
                        }
                    }
                    
                    // If we found exactly one external link, it's likely the website
                    if (externalLinks.length === 1) {
                        website = externalLinks[0];
                    } else if (externalLinks.length > 1) {
                        // Multiple external links - prefer direct URLs over tracking URLs
                        // First try to find a non-tracking URL
                        for (const href of externalLinks) {
                            if (!href.includes('google.com/aclk') && !href.includes('redirect') && 
                                !href.includes('track') && !href.includes('click')) {
                                website = href;
                                break;
                            }
                        }
                        // If no direct URL found, accept tracking URLs
                        if (!website && externalLinks.length > 0) {
                            website = externalLinks[0];
                        }
                    }
                }

                // Extract structured data from child elements
                // Google Maps organizes data in nested divs/spans
                const allElements = article.querySelectorAll('span, div');
                const textParts = [];
                
                for (const el of allElements) {
                    // Only get direct text content (not nested)
                    const directText = Array.from(el.childNodes)
                        .filter(node => node.nodeType === Node.TEXT_NODE)
                        .map(node => node.textContent.trim())
                        .join(' ')
                        .trim();
                    
                    if (directText && directText.length > 0) {
                        textParts.push(directText);
                    }
                }

                // Also get text from spans with specific content
                const spans = article.querySelectorAll('span');
                for (const span of spans) {
                    const text = span.textContent?.trim();
                    if (!text) continue;
                    
                    // Skip if it's just the name or rating/review
                    if (text === name) continue;
                    if (/^\d+\.?\d*$/.test(text)) continue;  // Just a number
                    if (/^\(\d+[,\d]*\)$/.test(text)) continue;  // Just (123)
                    
                    // Check for category (skip "Sponsored")
                    if (!category && isCategory(text) && text.toLowerCase() !== 'sponsored') {
                        category = text;
                        continue;
                    }
                    
                    // Check for address
                    if (!address && isAddress(text)) {
                        address = text;
                        continue;
                    }
                    
                    // Check for phone number
                    if (!phone && isPhoneNumber(text)) {
                        phone = text.trim();
                        continue;
                    }
                    
                    // Check for hours status
                    if (!hoursStatus && isHoursStatus(text)) {
                        hoursStatus = text.trim();
                        continue;
                    }
                }

                // Secondary extraction: look for patterns in aria-labels
                const buttons = article.querySelectorAll('button[aria-label], a[aria-label]');
                for (const btn of buttons) {
                    const label = btn.getAttribute('aria-label') || '';
                    
                    // Extract phone from aria-label
                    if (!phone && label.toLowerCase().includes('phone')) {
                        const phoneMatch = label.match(/phone[:\s]*([+\d\s\-\.\(\)]+)/i);
                        if (phoneMatch) {
                            phone = phoneMatch[1].trim();
                        }
                    }
                    
                    // Extract hours from aria-label
                    if (!hoursStatus && (label.includes('Open') || label.includes('Closed') || label.includes('Opens') || label.includes('Closes'))) {
                        hoursStatus = label;
                    }
                }

                // Try to extract address from concatenated text if not found
                if (!address) {
                    // Look for address patterns in the full text
                    // Common pattern: after category, before hours/phone
                    const addressMatch = textContent.match(/·\s*(\d+[^·]*(?:straat|weg|laan|street|road|avenue|drive|boulevard)[^·]*)/i);
                    if (addressMatch) {
                        address = addressMatch[1].trim();
                    }
                }

                // Extract phone from full text if not found
                if (!phone) {
                    // Dutch phone patterns: 020 xxx xxxx, +31 xx xxx xxxx, etc.
                    const phonePatterns = [
                        /(\+?\d{1,3}[\s\-]?\d{2,4}[\s\-]?\d{3}[\s\-]?\d{2,4})/,
                        /(0\d{2}[\s\-]?\d{3}[\s\-]?\d{4})/,
                        /(\d{3}[\s\-]?\d{3}[\s\-]?\d{4})/,
                    ];
                    
                    for (const pattern of phonePatterns) {
                        const match = textContent.match(pattern);
                        if (match && match[1].replace(/[\s\-]/g, '').length >= 9) {
                            phone = match[1].trim();
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
                    address: address,
                    phone: phone,
                    website: website,
                    hoursStatus: hoursStatus,
                    isSponsored: isSponsored,
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
                        address: null,
                        phone: null,
                        website: null,
                        hoursStatus: null,
                        isSponsored: false,
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

