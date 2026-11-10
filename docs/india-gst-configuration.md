# Lead Relay seller and Indian GST configuration

Prepared 10 November 2026 at the account holder's request. Public company particulars are in `src/content/seller.ts`. They are user-supplied facts, not a claim of independent MCA/GST portal verification.

- Legal name: NMT Solutions (OPC) Private Limited.
- CIN: U47912MH2025OPC438916.
- GSTIN: 27AAKCN1287D1ZE. Its format and check digit pass; its state prefix is Maharashtra (27). This does not establish active registration or taxpayer scheme.
- Registered address: 601/602, Uzair Tower CHS, Valipeer Road, JP Resort, Kalyan 421301, Maharashtra, India.
- Support: +91 8691861145; wafa.khan@nmtsolutions.in.
- Director and designated grievance officer: Wafa Karim Khan, using the same contact details. This designation follows the user's instruction; it is not an assertion that every OPC must appoint its director.

## Selected classification

**SAC 998315 — Hosting and information technology (IT) infrastructure provisioning services.** This is an inference from Lead Relay's actual supply: subscription access to software operated in a centrally hosted environment, rather than a separately delivered software copy or bespoke development engagement. The official explanatory notes expressly cover hosted software application provision. [GST Council explanatory notes, page 54](https://www.gstcouncil.gov.in/sites/default/files/2024-02/explanatory_notes_01oct19.pdf)

For a **regular GST taxpayer's ordinary domestic subscription sale**, the selected standard rate is **18%** under heading 9983. The published rate table specifies 9% central + 9% state tax, or 18% integrated tax, for the relevant general category. This does not select a rate for a composition supplier or promise that every future separately sold service uses the same SAC. [CBIC service rate table](https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html)

## Domestic calculation

Maharashtra recipient/place of supply: 9% CGST + 9% SGST. Another supported Indian state/territory: 18% IGST. The ordinary section 12(2) recipient-location basis is used for these domestic SaaS drafts; registered buyers must use the state matching their supplied GSTIN. SEZ supplies and other special cases are excluded from the ordinary self-service declaration. Unknown states are sent for review instead of being treated as Maharashtra. [IGST Act](https://taxinformation.cbic.gov.in/content-page/explore-act/1000620/1000001), [official state master](https://docs.ewaybillgst.gov.in/apidocs/state-code.html)

| Plan    |  Net INR |  GST INR | Gross INR |
| ------- | -------: | -------: | --------: |
| Starter | 1,999.00 |   359.82 |  2,358.82 |
| Growth  | 4,999.00 |   899.82 |  5,898.82 |
| Scale   | 9,999.00 | 1,799.82 | 11,798.82 |

These totals are the regular-taxpayer standard scenario. They are not yet an authorization to collect GST. No exempt, export, reverse-charge, zero-rated or SEZ treatment is inferred from an address, GSTIN or foreign card.

## Prepared records

`src/production/india-gst.ts` generates 72 draft rules: 36 supported states/territories × Business/Individual buyer classes. Rules use one explicit state each, avoiding overlapping nationwide and Maharashtra rules. State aliases normalize only to an official supported code; old/unknown territory codes are not guessed.

`scripts/prepare-india-gst.ts <authorizing-verified-account-email>` appends the initial drafts under an owner connection. It does not create approval decisions, grant operator roles, issue invoices or charge a customer. Existing configuration is not overwritten. Production arithmetic requires an approved rule; tests use explicitly synthetic approvals, never production evidence.

The invoice/credit-note issuer draft includes the supplied legal particulars, GSTIN, SAC, supplier state and support contact. For FY 2026–27 the distinct proposed series are `LR2627-000001` and `LC2627-000001`. Each is under 16 characters. The configuration expires at 1 April 2027, 00:00 India time; a new FY configuration is required rather than silently reusing the old series. Issued numbers, captures and artifacts remain immutable. Protected retention does not bypass longer statutory extensions, disputes or holds.

## Merchant declarations and activation

The account holder subsequently supplied the taxpayer-scheme and e-invoice-applicability facts. The actual declarations are retained in the private `.local/merchant-tax-confirmation-*.json` release evidence, outside public customer responses and Git. Approval decisions retain an evidence hash and account attribution. No CA or GST portal verification is claimed.

1. **Taxpayer scheme:** a composition taxpayer cannot collect GST separately and uses a bill of supply. A GSTIN alone does not establish the current scheme. Standard 18% tax rules must not be approved for a composition supplier. [CBIC composition rules](https://cbic-gst.gov.in/composition-rules.html)
2. **E-invoice threshold:** PAN-level historical turnover and statutory exceptions determine e-invoice applicability; it is not based only on Lead Relay revenue. If applicable, an IRN/QR-enabled issuance path is required before relevant invoices can be issued. No IRN is invented. Reassess when eligibility changes. [Notification 10/2023](https://www.gstcouncil.gov.in/node/4365), [GSTN e-invoice guidance](https://einvoice6.gst.gov.in/content/new-advisory-on-e-invoicing-enablement-status-update-for-taxpayers/)

After deploying the compatible invoice code, the owner-only `scripts/activate-india-gst.ts` releases the exact prepared rules using the actual supplied declarations. It refuses altered or withdrawn rules and expired/changed issuer drafts. The new `india_gst_text_v2` issuer uses India-local issue dates, SAC, supplier and recipient details, place of supply, tax rates/components, totals, payment reference and original invoice number/date on credit notes. Customer artifacts omit operator identities, approvals, private eligibility declarations and internal financial evidence. Existing `text_v1` rendering is preserved; issued artifacts are not rewritten. The current electronic-record signature proviso is in [CGST Rule 46](https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001) (official search excerpt retrieved; direct page retrieval timed out).

The classification and rates can be reviewed with the company's accountant as part of actual filing setup. No accountant approval, registration certificate validation, return filing or tax remittance was manufactured. Existing Razorpay live activation, Trigger deployment and discovery provisioning blockers remain separate.
