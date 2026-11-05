---
status: accepted
---

# Sell directly with app-owned billing and tax management

Sell the platform's subscriptions directly through a payment gateway, superseding [ADR 0005](0005-use-paddle-as-merchant-of-record.md) and removing Paddle as the selected Merchant of Record. Our business owns the sale and its tax obligations, while the application manages billing profiles, versioned tax treatment and evidence, invoices/credit notes, subscription entitlements, refunds/disputes, tax reports and filing/remittance records, and payment-to-bank reconciliation. Accept the engineering and operating cost of this ownership in exchange for direct control; gateway selection, actual fees, supported jurisdictions, and any filing integrations remain to be settled.

[ADR 0007](0007-use-razorpay-for-direct-subscriptions.md) subsequently selects Razorpay and the initial recurring-card scope; this direct-selling and app-owned tax decision remains accepted.
