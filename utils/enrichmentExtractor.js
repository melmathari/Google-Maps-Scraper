import { randomDelay } from './utils.js';

/**
 * Regex patterns for extracting various data from websites
 */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Common obfuscated email patterns
const OBFUSCATED_EMAIL_PATTERNS = [
    /([a-zA-Z0-9._%+-]+)\s*\[\s*at\s*\]\s*([a-zA-Z0-9.-]+)\s*\[\s*dot\s*\]\s*([a-zA-Z]{2,})/gi,
    /([a-zA-Z0-9._%+-]+)\s*\(\s*at\s*\)\s*([a-zA-Z0-9.-]+)\s*\(\s*dot\s*\)\s*([a-zA-Z]{2,})/gi,
    /([a-zA-Z0-9._%+-]+)\s*@\s*([a-zA-Z0-9.-]+)\s*\.\s*([a-zA-Z]{2,})/gi
];

// Social media URL patterns
const SOCIAL_PATTERNS = {
    facebook: [
        /(?:https?:\/\/)?(?:www\.)?facebook\.com\/(?:pages\/)?[a-zA-Z0-9._%-]+\/?/gi,
        /(?:https?:\/\/)?(?:www\.)?fb\.com\/[a-zA-Z0-9._%-]+\/?/gi
    ],
    instagram: [
        /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[a-zA-Z0-9._%-]+\/?/gi
    ],
    linkedin: [
        /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:company|in)\/[a-zA-Z0-9._%-]+\/?/gi
    ],
    twitter: [
        /(?:https?:\/\/)?(?:www\.)?twitter\.com\/[a-zA-Z0-9._%-]+\/?/gi,
        /(?:https?:\/\/)?(?:www\.)?x\.com\/[a-zA-Z0-9._%-]+\/?/gi
    ],
    youtube: [
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/(?:channel|c|user|@)[a-zA-Z0-9._%-\/]+\/?/gi
    ],
    tiktok: [
        /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[a-zA-Z0-9._%-]+\/?/gi
    ]
};

// Contact page URL patterns
const CONTACT_PAGE_PATTERNS = [
    /contact/i,
    /kontakt/i,
    /contacto/i,
    /contatti/i,
    /kontakta/i,
    /about/i,
    /about-us/i,
    /get-in-touch/i,
    /reach-us/i
];

// Invalid email patterns (to filter out)
const INVALID_EMAIL_PATTERNS = [
    /^[a-zA-Z0-9._%+-]+@example\./i,
    /^[a-zA-Z0-9._%+-]+@test\./i,
    /^(noreply|no-reply|donotreply)/i,
    /^(admin|root|webmaster|postmaster)@/i,
    /\.(png|jpg|jpeg|gif|svg|css|js|woff|ttf|eot)$/i,
    /sentry\.io/i,
    /wixpress\.com/i,
    /cloudflare/i
];

/**
 * Check if an email is valid and not a system/generic email
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
function isValidEmail(email) {
    if (!email || email.length < 6 || email.length > 254) return false;
    
    const lowerEmail = email.toLowerCase();
    
    // Check against invalid patterns
    for (const pattern of INVALID_EMAIL_PATTERNS) {
        if (pattern.test(lowerEmail)) return false;
    }
    
    // Must have valid TLD (at least 2 chars)
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    
    const domain = parts[1];
    const tld = domain.split('.').pop();
    if (!tld || tld.length < 2) return false;
    
    return true;
}

/**
 * Extract emails from text content
 * @param {string} text - Text to extract emails from
 * @returns {string[]}
 */
function extractEmailsFromText(text) {
    const emails = new Set();
    
    // Extract normal emails
    const normalMatches = text.match(EMAIL_REGEX) || [];
    normalMatches.forEach(email => {
        if (isValidEmail(email)) {
            emails.add(email.toLowerCase());
        }
    });
    
    // Extract obfuscated emails
    for (const pattern of OBFUSCATED_EMAIL_PATTERNS) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const reconstructed = `${match[1]}@${match[2]}.${match[3]}`;
            if (isValidEmail(reconstructed)) {
                emails.add(reconstructed.toLowerCase());
            }
        }
    }
    
    return [...emails];
}

/**
 * Extract social media links from text/HTML
 * @param {string} content - HTML/text content
 * @param {string[]} links - Array of links found on page
 * @returns {Object}
 */
function extractSocialLinks(content, links = []) {
    const social = {};
    
    // Combine content text and links for searching
    const searchText = content + ' ' + links.join(' ');
    
    for (const [platform, patterns] of Object.entries(SOCIAL_PATTERNS)) {
        for (const pattern of patterns) {
            const matches = searchText.match(pattern);
            if (matches && matches.length > 0) {
                // Get the first valid match that's not just the base domain
                for (const match of matches) {
                    const url = match.toLowerCase().replace(/\/$/, '');
                    // Skip if it's just the base domain
                    if (url === `https://www.${platform}.com` || 
                        url === `http://www.${platform}.com` ||
                        url === `https://${platform}.com` ||
                        url === `http://${platform}.com`) {
                        continue;
                    }
                    // Ensure URL has protocol
                    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
                    social[platform] = fullUrl;
                    break;
                }
            }
        }
    }
    
    return social;
}

/**
 * Find contact page URL from links
 * @param {string[]} links - Array of page links
 * @param {string} baseUrl - Base website URL
 * @returns {string|null}
 */
function findContactPageUrl(links, baseUrl) {
    try {
        const baseDomain = new URL(baseUrl).hostname;
        
        for (const link of links) {
            try {
                const url = new URL(link, baseUrl);
                const linkDomain = url.hostname;
                
                // Only consider links from the same domain
                if (!linkDomain.includes(baseDomain.replace('www.', '')) && 
                    !baseDomain.includes(linkDomain.replace('www.', ''))) {
                    continue;
                }
                
                const path = url.pathname.toLowerCase();
                
                // Check if path matches contact patterns
                for (const pattern of CONTACT_PAGE_PATTERNS) {
                    if (pattern.test(path)) {
                        return url.href;
                    }
                }
            } catch {
                // Invalid URL, skip
            }
        }
    } catch {
        // Invalid base URL
    }
    
    return null;
}

/**
 * Extract enrichment data from a business website
 * @param {Object} page - Puppeteer page
 * @param {string} websiteUrl - Website URL to scrape
 * @param {Object} options - Extraction options
 * @returns {Object} Enrichment data
 */
export async function extractEnrichmentData(page, websiteUrl, options = {}) {
    const {
        followContactPage = true,
        timeout = 15000,
        log = console
    } = options;
    
    const enrichment = {
        contact_page_url: null,
        emails_found: [],
        social: {}
    };
    
    if (!websiteUrl) {
        return enrichment;
    }
    
    try {
        log.info?.(`  🌐 Enriching from website: ${websiteUrl}`) || 
        console.log(`  🌐 Enriching from website: ${websiteUrl}`);
        
        // Navigate to website
        try {
            await page.goto(websiteUrl, {
                waitUntil: 'domcontentloaded',
                timeout
            });
        } catch (navError) {
            // If navigation times out, try to continue with what we have
            if (!navError.message.includes('timeout')) {
                throw navError;
            }
            log.warning?.(`  ⚠️ Website navigation timeout, trying to extract available data`) ||
            console.log(`  ⚠️ Website navigation timeout, trying to extract available data`);
        }
        
        await randomDelay(1500, 2500);
        
        // Extract data from the main page
        const pageData = await page.evaluate(() => {
            // Get all text content
            const bodyText = document.body?.innerText || '';
            
            // Get all links on the page
            const links = Array.from(document.querySelectorAll('a[href]'))
                .map(a => a.href)
                .filter(href => href && !href.startsWith('javascript:'));
            
            // Get HTML content (for finding emails in href mailto: links)
            const htmlContent = document.body?.innerHTML || '';
            
            // Extract mailto links specifically
            const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
                .map(a => a.href.replace('mailto:', '').split('?')[0]);
            
            return {
                bodyText,
                links,
                htmlContent,
                mailtoLinks
            };
        });
        
        // Extract emails from page content
        const textEmails = extractEmailsFromText(pageData.bodyText);
        const htmlEmails = extractEmailsFromText(pageData.htmlContent);
        const allEmails = [...new Set([...textEmails, ...htmlEmails, ...pageData.mailtoLinks])];
        enrichment.emails_found = allEmails.filter(isValidEmail);
        
        // Extract social links
        enrichment.social = extractSocialLinks(pageData.htmlContent, pageData.links);
        
        // Find contact page URL
        enrichment.contact_page_url = findContactPageUrl(pageData.links, websiteUrl);
        
        // If contact page found and followContactPage enabled, visit it for more data
        if (followContactPage && enrichment.contact_page_url && 
            enrichment.contact_page_url !== websiteUrl) {
            try {
                log.info?.(`  📧 Checking contact page: ${enrichment.contact_page_url}`) ||
                console.log(`  📧 Checking contact page: ${enrichment.contact_page_url}`);
                
                await page.goto(enrichment.contact_page_url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 10000
                });
                
                await randomDelay(1000, 2000);
                
                const contactPageData = await page.evaluate(() => {
                    const bodyText = document.body?.innerText || '';
                    const htmlContent = document.body?.innerHTML || '';
                    const links = Array.from(document.querySelectorAll('a[href]'))
                        .map(a => a.href);
                    const mailtoLinks = Array.from(document.querySelectorAll('a[href^="mailto:"]'))
                        .map(a => a.href.replace('mailto:', '').split('?')[0]);
                    
                    return { bodyText, htmlContent, links, mailtoLinks };
                });
                
                // Extract additional emails from contact page
                const contactEmails = [
                    ...extractEmailsFromText(contactPageData.bodyText),
                    ...extractEmailsFromText(contactPageData.htmlContent),
                    ...contactPageData.mailtoLinks
                ].filter(isValidEmail);
                
                // Merge emails (deduplicated)
                enrichment.emails_found = [...new Set([...enrichment.emails_found, ...contactEmails])];
                
                // Extract additional social links from contact page
                const contactSocial = extractSocialLinks(contactPageData.htmlContent, contactPageData.links);
                enrichment.social = { ...contactSocial, ...enrichment.social };
                
            } catch (contactError) {
                log.warning?.(`  ⚠️ Could not access contact page: ${contactError.message}`) ||
                console.log(`  ⚠️ Could not access contact page: ${contactError.message}`);
            }
        }
        
        // Log results
        const emailCount = enrichment.emails_found.length;
        const socialCount = Object.keys(enrichment.social).length;
        log.info?.(`  ✓ Enrichment complete: ${emailCount} email(s), ${socialCount} social link(s)`) ||
        console.log(`  ✓ Enrichment complete: ${emailCount} email(s), ${socialCount} social link(s)`);
        
    } catch (error) {
        log.warning?.(`  ⚠️ Enrichment failed for ${websiteUrl}: ${error.message}`) ||
        console.log(`  ⚠️ Enrichment failed for ${websiteUrl}: ${error.message}`);
    }
    
    return enrichment;
}

/**
 * Calculate quality score based on available data
 * @param {Object} business - Business object with enrichment data
 * @returns {number} Quality score (0-1)
 */
export function calculateQualityScore(business) {
    let score = 0;
    let maxScore = 10;
    
    // Base data points
    if (business.name) score += 1;
    if (business.phone) score += 1;
    if (business.website) score += 1;
    if (business.address) score += 1;
    if (business.rating) score += 0.5;
    if (business.reviewCount) score += 0.5;
    
    // Enrichment data points
    if (business.enrichment) {
        if (business.enrichment.emails_found?.length > 0) score += 2;
        if (business.enrichment.contact_page_url) score += 1;
        if (business.enrichment.social) {
            const socialCount = Object.keys(business.enrichment.social).length;
            score += Math.min(socialCount * 0.5, 2); // Max 2 points for social
        }
    }
    
    return Math.round((score / maxScore) * 10) / 10;
}

