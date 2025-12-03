# Google Maps Data Extractor

Powerful Apify Actor that extracts business information from Google Maps. Get names, ratings, reviews, contact details, websites, and addresses for any business type in any location worldwide.

## What It Does

This tool searches Google Maps for businesses matching your criteria and extracts their public information. Whether you need data on restaurants in Tokyo, plumbers in London, or hotels in New York — this extractor handles it all.

**Key Capabilities:**
- Search any business category (restaurants, hotels, dentists, gyms, etc.)
- Target any geographic location globally
- Extract contact information (phone, website, address)
- Capture ratings and review counts
- Get business hours and status
- Optional deep extraction for complete data

## Output Fields

| Field | Description | Availability |
|-------|-------------|--------------|
| `name` | Business name | Always |
| `url` | Google Maps link | Always |
| `rating` | Star rating (1-5) | Usually |
| `reviewCount` | Number of reviews | Usually |
| `category` | Business type | Usually |
| `address` | Full street address | With details |
| `phone` | Contact number | With details |
| `website` | Business website | With details |
| `hoursStatus` | Open/closed status | With details |
| `priceLevel` | Price indicator | When available |
| `scrapedAt` | Extraction timestamp | Always |

### Sample Output

```json
{
  "name": "The Coffee House",
  "url": "https://www.google.com/maps/place/...",
  "rating": 4.7,
  "reviewCount": 892,
  "category": "Coffee shop",
  "address": "123 Main Street, New York, NY 10001",
  "phone": "+1 212-555-0123",
  "website": "https://thecoffeehouse.com",
  "hoursStatus": "Open · Closes 9 PM",
  "scrapedAt": "2025-12-02T10:30:00.000Z"
}
```

## Input Configuration

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `searchQuery` | string | Yes | — | Business type to find (e.g., "dentists", "pizza") |
| `location` | string | No | — | Target area (e.g., "Chicago, IL", "Paris, France") |
| `maxResults` | integer | No | 100 | How many businesses to extract (0 = no limit) |
| `scrapeDetails` | boolean | No | false | Visit each listing for full details |
| `proxyConfiguration` | object | No | Residential | Proxy settings |
| `minDelay` | integer | No | 1 | Min seconds between requests |
| `maxDelay` | integer | No | 3 | Max seconds between requests |
| `debugScreenshots` | boolean | No | false | Capture screenshots on errors for debugging |

### Filtering Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `skipSponsored` | boolean | false | Skip all sponsored/ad listings, only return organic results |
| `skipWithWebsite` | boolean | false | Only return listings WITHOUT a website (for lead generation) |
| `skipWithPhone` | boolean | false | Only return listings WITHOUT a phone number |
| `skipWithoutContact` | boolean | false | Skip listings that have neither phone nor email |

## Usage Examples

### Find Restaurants in a City

```json
{
  "searchQuery": "restaurants",
  "location": "San Francisco, CA",
  "maxResults": 50
}
```

### Get Complete Hotel Information

```json
{
  "searchQuery": "hotels",
  "location": "Miami Beach, FL",
  "maxResults": 30,
  "scrapeDetails": true
}
```

### Extract Local Service Providers

```json
{
  "searchQuery": "plumbers",
  "location": "Austin, TX",
  "maxResults": 100,
  "scrapeDetails": true
}
```

### International Search

```json
{
  "searchQuery": "sushi restaurants",
  "location": "Tokyo, Japan",
  "maxResults": 40,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

### Lead Generation (Businesses Without Websites)

```json
{
  "searchQuery": "cleaning services",
  "location": "Amsterdam, Netherlands",
  "maxResults": 50,
  "skipSponsored": true,
  "skipWithWebsite": true,
  "skipWithoutContact": true
}
```

## Practical Applications

**Lead Generation**
Find potential customers or partners in specific industries and locations. Extract contact details for outreach campaigns.

**Market Research**
Analyze business density, ratings distribution, and competitive landscape in target markets.

**Competitor Analysis**
Monitor competitors' ratings, review counts, and presence across different locations.

**Location Intelligence**
Map out business distribution for site selection, franchise planning, or market entry decisions.

**Data Enrichment**
Supplement existing business databases with current contact information and ratings.

## Running the Extractor

### On Apify Platform

1. Go to [Apify Console](https://console.apify.com/)
2. Create new Actor from this source
3. Build the Actor
4. Set your input parameters
5. Run and download results

### Local Development

```bash
npm install

# Set your Apify token for proxy access
export APIFY_TOKEN=your_token

# Create input.json with your parameters
npm start
```

## Performance Tips

**Speed vs. Completeness**
- `scrapeDetails: false` — Fast extraction, basic data only
- `scrapeDetails: true` — Slower but gets phone, website, full address

**Proxy Options**
- **Datacenter proxies** — Cheapest option, works well for most searches
- **Residential proxies** — More reliable for large-scale extraction, recommended if you experience blocks
- Keep delays at 1-3 seconds (default)
- Start with smaller batches to test

**Best Results**
- Be specific with search queries ("italian restaurants" vs "food")
- Always include location for targeted results
- Use realistic `maxResults` values (Google Maps shows ~60-120 results per search)

## Data Accuracy

**From Search Results:**
- Name: ~100%
- Rating: ~90%
- Review Count: ~90%

**With Detail Extraction:**
- Phone: ~70%
- Address: ~95%
- Website: ~60%
- Hours: ~80%

*Some businesses don't list all information publicly.*

## Troubleshooting

**No results returned?**
- Verify the location exists and is spelled correctly
- Try broader search terms
- Check that businesses exist for your query in that area

**Getting blocked?**
- Ensure residential proxy is enabled
- Increase delay settings
- Reduce batch size

**Missing contact details?**
- Enable `scrapeDetails: true`
- Some businesses simply don't list this information

## Technical Details

**Stack:** Node.js, Puppeteer, Crawlee, Apify SDK

**Requirements:** Node.js 18+

**Rate Limiting:** Single concurrent request (safest for Google Maps)

**Proxy:** Residential proxies strongly recommended

## Project Structure

```
├── .actor/
│   ├── actor.json           # Actor configuration
│   ├── INPUT_SCHEMA.json    # Input definition
│   ├── dataset_schema.json  # Output schema
│   └── key_value_store_schema.json
├── main.js                  # Extraction logic
├── package.json            
├── Dockerfile              
└── README.md               
```

## Disclaimer

**This project is not affiliated with, endorsed by, or sponsored by Google.** Google Maps is a trademark of Google LLC.

This tool extracts publicly available information from Google Maps. Users are responsible for:
- Complying with Google's Terms of Service
- Following applicable data protection laws (GDPR, CCPA, etc.)
- Using extracted data ethically and legally

## Support

Having issues? Check:
1. Input parameters are valid
2. Proxy configuration is correct
3. Search returns results when done manually
4. Actor logs for specific errors