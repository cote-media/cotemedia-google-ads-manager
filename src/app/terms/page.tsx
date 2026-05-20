export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
          <p className="text-gray-500 text-sm">Advar by Cote Media · Last updated: May 20, 2026</p>
        </div>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 text-sm leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
            <p>By accessing or using Advar ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. These terms apply to all users, including marketing agencies, businesses, and individuals accessing the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">2. Description of Service</h2>
            <p>Advar is a business intelligence platform that connects to advertising platforms (Google Ads, Meta Ads) and ecommerce platforms (Shopify) to provide analytics, reporting, and AI-powered insights. The Service is provided by Cote Media.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">3. Use of the Service</h2>
            <p className="mb-3">You agree to use the Service only for lawful purposes and in accordance with these Terms. You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Use the Service to violate any applicable law or regulation</li>
              <li>Attempt to gain unauthorized access to any part of the Service</li>
              <li>Use the Service to process data you do not have the right to access</li>
              <li>Reverse engineer, decompile, or disassemble the Service</li>
              <li>Use the Service in any way that could damage, disable, or impair it</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">4. Account Responsibilities</h2>
            <p>You are responsible for maintaining the security of your account credentials and for all activity that occurs under your account. You must notify us immediately of any unauthorized use of your account. We are not liable for losses caused by unauthorized use of your account.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">5. Third-Party Integrations</h2>
            <p>The Service integrates with third-party platforms including Google Ads, Meta Ads, and Shopify. Your use of these integrations is subject to the respective terms of service of those platforms. We are not responsible for the availability, accuracy, or policies of third-party services. Connecting a third-party account grants Advar access only to the data scopes you authorize.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">6. AI-Powered Features</h2>
            <p>Advar uses Anthropic's Claude AI to generate insights and recommendations. AI-generated content is provided for informational purposes only and does not constitute professional financial, legal, or marketing advice. You are responsible for evaluating and acting on any AI-generated recommendations. We do not guarantee the accuracy or completeness of AI-generated insights.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">7. Data and Privacy</h2>
            <p>Your use of the Service is also governed by our <a href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</a>, which is incorporated into these Terms by reference. You represent that you have the right to connect the accounts and data sources you link to Advar, and that doing so does not violate any third-party rights or agreements.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">8. Intellectual Property</h2>
            <p>The Service, including its design, code, and content, is owned by Cote Media and protected by intellectual property laws. You retain ownership of your data. You grant Cote Media a limited license to process your data solely to provide the Service. We do not claim ownership of your advertising data, store data, or client information.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">9. Disclaimer of Warranties</h2>
            <p>The Service is provided "as is" without warranties of any kind, express or implied. We do not warrant that the Service will be uninterrupted, error-free, or that data will always be accurate or up to date. API data accuracy depends on third-party platforms (Google, Meta, Shopify) and we are not responsible for discrepancies in data provided by those platforms.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">10. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, Cote Media shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service, including but not limited to loss of revenue, loss of data, or business interruption, even if we have been advised of the possibility of such damages.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">11. Termination</h2>
            <p>We reserve the right to suspend or terminate your access to the Service at any time for violation of these Terms. You may terminate your account at any time by contacting us. Upon termination, your data will be handled in accordance with our Privacy Policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">12. Changes to Terms</h2>
            <p>We may modify these Terms at any time. We will provide notice of material changes via email or in-app notification. Continued use of the Service after changes constitutes acceptance of the updated Terms.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">13. Governing Law</h2>
            <p>These Terms are governed by the laws of the State of Georgia, United States, without regard to conflict of law principles.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">14. Contact</h2>
            <p>For questions about these Terms:</p>
            <div className="mt-2 space-y-1">
              <p><strong>Cote Media</strong></p>
              <p>Email: <a href="mailto:cotebrandmarketing@gmail.com" className="text-blue-600 hover:underline">cotebrandmarketing@gmail.com</a></p>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
