---
status: accepted
---

# Release India with Razorpay before international MoR billing

Release new subscriptions only for Indian billing addresses, in INR through Razorpay, while NMT chooses and configures a Merchant of Record for international sales. This narrows ADR 0007's new-purchase scope and retains ADR 0006's direct-selling and India GST responsibilities for domestic transactions; future international customer invoices and transaction taxes belong to the contracted MoR. Keep historical payment reconciliation, invoices and cancellation available, and apply the India release checks to all new checkout paths, including advanced payment APIs, pilots and paid plan changes, rather than relying on the public pricing screen.
