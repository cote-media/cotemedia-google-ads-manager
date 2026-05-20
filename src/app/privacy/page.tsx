export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-gray-500 text-sm">Advar by Cote Media · Last updated: May 20, 2026</p>
        </div>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">1. About Advar</h2>
            <p>Advar is a business intelligence platform built by Cote Media that helps marketing agencies and businesses analyze advertising and ecommerce performance data. Advar connects to Google Ads, Meta Ads, and Shopify to surface insights and recommendations powered by Claude AI (Anthropic).</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">2. Data We Access</h2>
            <p className="mb-3">Advar accesses the following data solely to provide its analytics and intelligence features:</p>
            <div className="space-y-3">
              <div>
                <p className="font-medium text-gray-900">Google Ads</p>
                <p>Campaign performance metrics (spend, clicks, impressions, conversions), ad group and keyword data, conversion action names and counts, and bid strategy settings. We do not access individual user data, search queries, or personal information of your customers.</p>
              </div>
              <div>
                <p className="font-medium text-gray-900">Meta Ads</p>
                <p>Campaign, ad set, and ad performance metrics, audience targeting configurations (aggregate only), placement breakdowns, and creative performance data. We do not access personal data of individuals who saw or interacted with your ads.</p>
              </div>
              <div>
                <p className="font-medium text-gray-900">Shopify</p>
                <p>Order totals and counts, product names and revenue, customer counts (new vs. returning), and order line items for product performance analysis. We access the minimum data required to provide store performance analytics. We do not access payment card information, customer passwords, or personal contact details beyond what is necessary for aggregate analytics.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">3. How We Use Data</h2>
            <p className="mb-3">We use the data described above exclusively to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Display performance dashboards and analytics within the Advar platform</li>
              <li>Generate AI-powered insights and recommendations using Anthropic's Claude AI</li>
              <li>Identify performance trends, anomalies, and optimization opportunities</li>
              <li>Enable cross-platform analysis (e.g. connecting ad spend to ecommerce revenue)</li>
            </ul>
            <p className="mt-3">We do not sell, share, or use your data for any purpose other than providing Advar's services to you.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">4. Data Storage and Retention</h2>
            <p className="mb-3">Advar stores the following data in our secure database (Supabase, hosted on AWS):</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Client profiles and notes</strong> — stored until you delete the client or your account</li>
              <li><strong>Platform connection tokens</strong> — stored until you disconnect the platform or uninstall the app</li>
              <li><strong>Cached analytics data</strong> — cached for up to 15 minutes to reduce API calls, then refreshed</li>
              <li><strong>Claude conversation history</strong> — stored per client to improve future analysis; deleted when you clear conversations or delete the client</li>
            </ul>
            <p className="mt-3">Upon uninstallation of the Shopify app, all store data is deleted within 30 days in accordance with Shopify's data deletion requirements. You can request immediate deletion by contacting us at the address below.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">5. Data Security</h2>
            <p>All data is encrypted in transit using TLS/HTTPS. Data at rest is encrypted by our database provider (Supabase). Platform access tokens are stored securely and never exposed to other users. We implement row-level security to ensure users can only access their own data.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">6. Third-Party Services</h2>
            <p className="mb-3">Advar integrates with the following third-party services to provide its functionality:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Anthropic Claude AI</strong> — analytics data is sent to Anthropic's API to generate insights. Anthropic's privacy policy applies to data processed by Claude. We do not send personally identifiable customer data to Claude.</li>
              <li><strong>Google Ads API</strong> — accessed via OAuth with your authorization</li>
              <li><strong>Meta Ads API</strong> — accessed via OAuth with your authorization</li>
              <li><strong>Shopify API</strong> — accessed via OAuth with your authorization</li>
              <li><strong>Supabase</strong> — our database provider, hosted on AWS</li>
              <li><strong>Vercel</strong> — our hosting provider</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">7. Your Rights</h2>
            <p className="mb-3">You have the right to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Access the data we hold about you or your connected accounts</li>
              <li>Request deletion of your data at any time</li>
              <li>Disconnect any platform integration at any time, which immediately revokes our access</li>
              <li>Export your client profile and conversation data upon request</li>
            </ul>
            <p className="mt-3">To exercise any of these rights, contact us at <a href="mailto:cotebrandmarketing@gmail.com" className="text-blue-600 hover:underline">cotebrandmarketing@gmail.com</a>.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">8. Shopify Merchant Data</h2>
            <p className="mb-3">For merchants using Advar via the Shopify App Store:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>We process only the data scopes you authorize during installation: <code className="bg-gray-100 px-1 rounded">read_orders</code>, <code className="bg-gray-100 px-1 rounded">read_products</code>, <code className="bg-gray-100 px-1 rounded">read_customers</code>, <code className="bg-gray-100 px-1 rounded">read_analytics</code>, <code className="bg-gray-100 px-1 rounded">read_inventory</code>, <code className="bg-gray-100 px-1 rounded">read_price_rules</code></li>
              <li>We respect Shopify's mandatory data deletion webhooks. Upon receiving a shop/redact webhook, all store data is deleted within 30 days</li>
              <li>We do not use merchant or customer data for advertising, profiling, or any purpose other than providing analytics to the merchant</li>
              <li>Customer data accessed through Shopify is used only in aggregate form for analytics (e.g. "142 new customers this month") and is never shared with third parties</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">9. GDPR and CCPA</h2>
            <p>Advar is committed to compliance with applicable data protection regulations including GDPR (EU) and CCPA (California). We act as a data processor on behalf of our users (merchants and agencies), who are the data controllers for their customer data. We do not sell personal data. We do not use personal data for automated decision-making that would have legal or significant effects on individuals.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">10. Contact</h2>
            <p>For privacy inquiries, data requests, or to report a concern:</p>
            <div className="mt-2 space-y-1">
              <p><strong>Cote Media</strong></p>
              <p>Email: <a href="mailto:cotebrandmarketing@gmail.com" className="text-blue-600 hover:underline">cotebrandmarketing@gmail.com</a></p>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">11. Changes to This Policy</h2>
            <p>We may update this privacy policy from time to time. We will notify active users of material changes via email or in-app notification. Continued use of Advar after changes constitutes acceptance of the updated policy.</p>
          </section>

        </div>
      </div>
    </div>
  )
}
