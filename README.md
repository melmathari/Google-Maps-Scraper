# Google Maps Business & Review Scraper

Production-ready Apify Actor for scraping business listings, reviews, and detailed information from Google Maps worldwide. Extract comprehensive data for local businesses, competitor analysis, market research, and lead generation.

## 🌍 **Coverage**

**Worldwide** - Works in any country, any language, any location!

Perfect for:
- 🍽️ Restaurants & Food Services
- 🏨 Hotels & Accommodations
- 🏪 Retail Stores & Shopping
- 💼 Professional Services
- 🏥 Healthcare & Medical
- 🔧 Home Services & Contractors
- 💇 Beauty & Personal Care
- 🎓 Education & Training
- And ANY business type on Google Maps!

## ✨ **Features**

- ✅ **Search Any Business Type** - Restaurants, hotels, shops, services, etc.
- ✅ **Worldwide Coverage** - Works in all countries and languages
- ✅ **Comprehensive Data** - Name, rating, reviews, address, phone, website, hours
- ✅ **Optional Detail Scraping** - Visit each business page for complete information
- ✅ **Smart Scrolling** - Automatically loads more results
- ✅ **Anti-Detection** - Built-in delays, proxy support, stealth measures
- ✅ **Incremental Saving** - Data saved progressively to avoid loss
- ✅ **Production Ready** - Clean code, error handling, well-documented

## 📊 **Extracted Data**

### Basic Data (from search results)
- Business name
- Rating (1-5 stars)
- Review count
- Category/type
- Address snippet
- Google Maps URL

### Detailed Data (when `scrapeDetails: true`)
- **Full address**
- **Phone number**
- **Website URL**
- **Business hours** (open/closed status)
- **Category/type** (verified)
- **Price level** (if available)
- Plus all basic data fields

### Example Output

```json
{
  "name": "Al Abraaj Restaurant",
  "url": "https://www.google.com/maps/place/...",
  "rating": 4.5,
  "reviewCount": 1250,
  "category": "Arabic restaurant",
  "address": "Building 123, Road 456, Manama, Bahrain",
  "phone": "+973 1234 5678",
  "website": "https://alabraaj.com",
  "hoursStatus": "Open ⋅ Closes 11 PM",
  "priceLevel": "Moderate",
  "scrapedAt": "2025-11-18T14:30:00.000Z"
}
```

## 🔧 **Input Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `searchQuery` | string | ✅ Yes | - | What to search for (e.g., "restaurants", "hotels") |
| `location` | string | No | - | Where to search (e.g., "Dubai", "Kuwait City") |
| `maxResults` | integer | No | 100 | Maximum businesses to scrape (1-500) |
| `scrapeDetails` | boolean | No | false | Visit each business page for detailed info |
| `proxyConfiguration` | object | No | See below | Proxy settings (residential recommended) |
| `minDelay` | integer | No | 1 | Minimum delay between actions (seconds) |
| `maxDelay` | integer | No | 3 | Maximum delay between actions (seconds) |

### Proxy Configuration Options

| Property | Type | Description |
|----------|------|-------------|
| `useApifyProxy` | boolean | Use Apify's proxy service |
| `apifyProxyGroups` | array | Proxy groups to use (e.g., `["RESIDENTIAL"]`, `["SHADER"]`) |
| `apifyProxyCountry` | string | Country code for proxy (e.g., `"US"`, `"GB"`, `"AE"`) |
| `proxyUrls` | array | Custom proxy URLs (when not using Apify proxy) |

**Default proxy configuration:**
```json
{
  "useApifyProxy": true,
  "apifyProxyGroups": ["RESIDENTIAL"]
}
```

## 📖 **Usage Examples**

### Example 1: Restaurants in Dubai

```json
{
  "searchQuery": "restaurants",
  "location": "Dubai, UAE",
  "maxResults": 50,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

**Output**: 50 restaurants in Dubai with ratings, review counts, and basic info.

---

### Example 2: Hotels in Kuwait with Full Details

```json
{
  "searchQuery": "hotels",
  "location": "Kuwait City",
  "maxResults": 30,
  "scrapeDetails": true,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

**Output**: 30 hotels with complete information including phone numbers, websites, and addresses.

---

### Example 3: Coffee Shops in Bahrain (with US Proxy)

```json
{
  "searchQuery": "coffee shops in Manama",
  "maxResults": 20,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "US"
  }
}
```

**Output**: 20 coffee shops in Manama (using US-based residential proxy).

---

### Example 4: Gyms in Riyadh

```json
{
  "searchQuery": "gyms",
  "location": "Riyadh, Saudi Arabia",
  "maxResults": 40,
  "scrapeDetails": true
}
```

---

### Example 5: Dentists in Doha

```json
{
  "searchQuery": "dentists near me",
  "location": "Doha, Qatar",
  "maxResults": 25,
  "scrapeDetails": true
}
```

---

## 🚀 **Quick Start**

### Running on Apify Platform

1. Create a new Actor on [Apify Console](https://console.apify.com/)
2. Upload all files from this repository
3. Click "Build"
4. Configure your input
5. Click "Start"

### Running Locally

```bash
# Install dependencies
npm install

# Set Apify token (if using proxy)
export APIFY_TOKEN=your_token_here

# Create input.json
cat > input.json << EOF
{
  "searchQuery": "restaurants",
  "location": "Dubai",
  "maxResults": 20,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
EOF

# Run
npm start
```

---

## 💡 **Use Cases**

### 1. **Competitor Analysis**
Scrape all competitors in your area:
```json
{
  "searchQuery": "italian restaurants",
  "location": "Dubai Marina",
  "maxResults": 100,
  "scrapeDetails": true
}
```

### 2. **Lead Generation**
Find potential clients:
```json
{
  "searchQuery": "real estate agents",
  "location": "Abu Dhabi",
  "maxResults": 200,
  "scrapeDetails": true
}
```

### 3. **Market Research**
Analyze a market:
```json
{
  "searchQuery": "coffee shops",
  "location": "Riyadh",
  "maxResults": 500
}
```

### 4. **Review Analysis**
Collect review data (future feature - can be added):
```json
{
  "searchQuery": "hotels",
  "location": "Doha",
  "scrapeReviews": true,
  "maxReviews": 50
}
```

---

## 💰 **Cost Estimates**

Costs depend on:
- Number of businesses scraped
- Whether details are scraped
- Proxy usage

**Approximate costs**:
- **50 businesses** (basic): ~$0.05 - $0.15
- **100 businesses** (basic): ~$0.10 - $0.30
- **50 businesses** (with details): ~$0.25 - $0.75
- **100 businesses** (with details): ~$0.50 - $1.50

*Costs are estimates and may vary.*

---

## ⚙️ **Configuration Tips**

### For Best Results

1. **Always use proxy**: Set `proxy: true` to avoid Google blocking
2. **Start small**: Test with `maxResults: 10` first
3. **Specific searches**: Use detailed queries ("italian restaurants in downtown Dubai")
4. **Respect rate limits**: Use default delays (1-3 seconds)

### Optimizing Performance

1. **Skip details**: Set `scrapeDetails: false` for 5-10x faster scraping
2. **Batch searches**: Run multiple smaller searches instead of one large search
3. **Use location**: Always specify location for better results

### Avoiding Blocks

1. **Use residential proxy**: Enabled by default
2. **Add delays**: Increase `minDelay` and `maxDelay` if needed
3. **Low concurrency**: Actor uses concurrency=1 by default (safest)
4. **Don't scrape too much**: Google may block if you scrape thousands at once

---

## 🐛 **Troubleshooting**

### No Results Found

**Problem**: Actor completes but finds 0 businesses

**Solutions**:
1. Check your search query is valid
2. Try adding a location
3. Verify the location exists ("Dubaiiii" won't work)
4. Try a more generic search ("food" instead of "vegan gluten-free organic restaurants")

### Getting Blocked

**Problem**: Actor fails with timeout or CAPTCHA errors

**Solutions**:
1. Ensure `proxy: true`
2. Increase delays (`minDelay: 2`, `maxDelay: 5`)
3. Reduce `maxResults`
4. Wait a few hours before trying again

### Missing Data

**Problem**: Some businesses don't have phone, address, etc.

**Solutions**:
1. Enable `scrapeDetails: true`
2. Some businesses simply don't have all data
3. Check if the business page loads manually

---

## 📈 **Data Quality**

### Completeness

From **search results only** (`scrapeDetails: false`):
- Name: 100%
- URL: 100%
- Rating: ~90%
- Review Count: ~90%
- Category: ~80%
- Address Snippet: ~60%

With **detail scraping** (`scrapeDetails: true`):
- Phone: ~70%
- Full Address: ~95%
- Website: ~60%
- Hours: ~80%
- All other fields: Higher accuracy

### Accuracy

- Data comes directly from Google Maps (official source)
- Real-time extraction (always current)
- No duplicates (URL-based deduplication)

---

## 🔐 **Legal & Privacy**

### Important Notes

1. **Public Data Only**: This scraper only collects publicly available information from Google Maps
2. **Google ToS**: Review Google's Terms of Service before large-scale scraping
3. **Rate Limiting**: Use responsible scraping practices (proxies, delays)
4. **Personal Data**: Be mindful of privacy regulations (GDPR, etc.) when storing/using data
5. **Commercial Use**: Verify licensing requirements for your use case

### Responsible Scraping

- Use proxies to distribute load
- Implement delays between requests
- Don't overwhelm servers
- Only scrape public data
- Respect robots.txt
- Use data ethically

---

## 🛠️ **Development**

### Project Structure

```
google-maps-scraper/
├── .actor/
│   ├── actor.json              # Actor metadata
│   └── INPUT_SCHEMA.json       # Input configuration
├── main.js                     # Main scraper logic
├── package.json                # Dependencies
├── Dockerfile                  # Docker configuration
├── README.md                   # Documentation
└── .gitignore                 # Git ignore rules
```

### Key Functions

- `constructGoogleMapsUrl()` - Builds search URL
- `scrollSidebar()` - Handles infinite scroll
- `extractBusinessListings()` - Extracts search results
- `extractBusinessDetails()` - Scrapes detail pages

### Adding Features

Want to add review scraping, photos, or Q&A? The code is modular and easy to extend!

---

## 📚 **Resources**

- [Apify Documentation](https://docs.apify.com/)
- [Crawlee Documentation](https://crawlee.dev/)
- [Puppeteer Documentation](https://pptr.dev/)
- [Google Maps](https://www.google.com/maps)

---

## 🤝 **Support**

For issues or questions:

1. Check this README
2. Review the troubleshooting section
3. Test with a small `maxResults` (10-20)
4. Check Apify Console logs
5. Verify your input parameters

---

## 📄 **License**

Apache-2.0

---

## 🏷️ **Version**

**Version**: 1.0.0
**Last Updated**: 2025-11-18
**Compatible with**: Apify SDK v3+, Crawlee v3+

---

**Happy Scraping! 🎉**

*Extract valuable business data from Google Maps with ease!*
