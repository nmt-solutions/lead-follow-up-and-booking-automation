# Published full-product tickets

Published and verified: **59 GitHub sub-issues**, **95 native blocking relationships**, all labeled `ready-for-agent`.

Source: [spec #1](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/1). Its body, title, state, labels and comments were preserved. Existing [Exa procurement #2](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/2) remains unchanged and is not duplicated.

Coverage: all 148 user stories and 42 acceptance scenarios are mapped in [the coverage index](coverage.md). T-identifiers below retain the approved draft-to-GitHub mapping; GitHub is the active issue tracker.

Provider contracts/credentials and supported commercial/policy configuration gate live activation rather than deterministic implementation. UPI AutoPay remains a later validated capability and does not block the initial cards-only pilot.

1. **[#3: Create a private Business and edit its profile](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/3)** (T01)
   - **Blocked by:** None (can start immediately).
   - **Delivers:** An owner can sign in, create a Business, save its profile and return to the same isolated records.

2. **[#4: Invite teammates and enforce Business roles](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/4)** (T02)
   - **Blocked by:** [#3](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/3).
   - **Delivers:** Owners and admins manage invitations and team access while salespeople and platform operators receive only their intended capabilities.

3. **[#5: Require MFA for privileged production access](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/5)** (T03)
   - **Blocked by:** [#4](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/4).
   - **Delivers:** A privileged user enrolls in MFA and cannot use protected production capabilities without satisfying it.

4. **[#6: Configure offerings, buyers and home geography](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/6)** (T04)
   - **Blocked by:** [#3](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/3).
   - **Delivers:** Each Business saves what it sells, whom it targets and where it operates without an industry or India-first restriction.

5. **[#7: Maintain approved answers and qualification goals](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/7)** (T05)
   - **Blocked by:** [#6](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/6).
   - **Delivers:** A Business maintains approved knowledge, missing-information questions and booking or quotation-request goals for its sales conversations.

6. **[#8: Upload and retrieve private Business files](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/8)** (T06)
   - **Blocked by:** [#3](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/3).
   - **Delivers:** An authorized user uploads a Business document and retrieves it privately with visible ownership and retention status.

7. **[#9: Configure commercial authority and approval limits](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/9)** (T07)
   - **Blocked by:** [#4](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/4), [#7](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/7).
   - **Delivers:** An owner controls which prices, quotations, discounts and orders the service may handle automatically and which require approval.

8. **[#10: Run bounded discovery and review sourced prospects](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/10)** (T08)
   - **Blocked by:** [#6](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/6).
   - **Delivers:** A Business submits a Discovery brief and receives a persisted, budget-bounded run with evidence-backed potential buyers.

9. **[#11: Separate buying requests and verify buyer contacts](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/11)** (T09)
   - **Blocked by:** [#10](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/10).
   - **Delivers:** Salespeople distinguish Potential buyers from genuinely open buying requests and can inspect contact-role evidence and uncertainty.

10. **[#12: Consolidate repeat discoveries and refresh evidence](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/12)** (T10)

- **Blocked by:** [#11](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/11).
- **Delivers:** Repeated runs update the same Business's prospects while preserving source history and honest request freshness.

11. **[#13: Approve extra discovery spend and resume partial runs](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/13)** (T11)

- **Blocked by:** [#10](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/10).
- **Delivers:** A Business inspects a stopped run and explicitly approves a bounded increase before research continues.

12. **[#14: Schedule saved searches and recover durable runs](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/14)** (T12)

- **Blocked by:** [#10](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/10).
- **Delivers:** A Business saves a Discovery brief and runs it on its local schedule without losing or duplicating work after a worker restart.

13. **[#15: Preview AI task profiles and track BYOK fallback](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/15)** (T13)

- **Blocked by:** [#7](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/7).
- **Delivers:** An operator previews approved extraction or drafting tasks, switches a validated model profile and sees provider/fallback consumption.

14. **[#16: Connect Exa Search and Contents to discovery](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/16)** (T14)

- **Blocked by:** [#11](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/11).
- **Delivers:** A configured Business runs discovery through the selected Exa adapter and reviews retained results within the acquired data scope.

15. **[#17: Capture incoming inquiries in a shared sales inbox](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/17)** (T15)

- **Blocked by:** [#3](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/3).
- **Delivers:** A Business receives an inquiry, opens it in a shared inbox and sees its buyer, conversation and initial Opportunity.

16. **[#18: Associate conversations with distinct purchasing needs](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/18)** (T16)

- **Blocked by:** [#17](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/17).
- **Delivers:** A salesperson links channels and repeated messages to the right buyer and Opportunity while keeping independent needs separate.

17. **[#19: Take over an Opportunity and explicitly hand it back](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/19)** (T17)

- **Blocked by:** [#18](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/18).
- **Delivers:** A salesperson assumes control of one Opportunity, pauses its automation across channels and later explicitly resumes it.

18. **[#20: Answer and qualify inquiries from approved knowledge](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/20)** (T18)

- **Blocked by:** [#15](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/15), [#19](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/19).
- **Delivers:** Incoming inquiries receive grounded answers and only missing qualification questions, with human escalation for uncertainty.

19. **[#21: Capture a qualified quotation request](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/21)** (T19)

- **Blocked by:** [#20](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/20).
- **Delivers:** A product-led Business collects a complete RFQ and moves it through its native quotation-request workflow without a calendar dependency.

20. **[#22: Approve permitted prices, quotes, discounts and orders](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/22)** (T20)

- **Blocked by:** [#9](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/9), [#21](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/21).
- **Delivers:** A Business completes commercial actions within its configured authority and sends exceptions for explicit approval.

21. **[#23: Request and authoritatively confirm an appointment](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/23)** (T21)

- **Blocked by:** [#20](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/20).
- **Delivers:** A Business offers available slots and confirms a booking only after the authoritative calendar event is created and retained.

22. **[#24: Connect Google Calendar for appointment booking](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/24)** (T22)

- **Blocked by:** [#23](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/23).
- **Delivers:** A Business grants calendar access separately from mail and books through a customer-owned Google calendar.

23. **[#25: Connect Microsoft calendars for appointment booking](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/25)** (T23)

- **Blocked by:** [#23](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/23).
- **Delivers:** A Business books through its Microsoft calendar using an account-appropriate availability path and separate calendar authorization.

24. **[#26: Log human calls and their sales outcomes](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/26)** (T24)

- **Blocked by:** [#18](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/18).
- **Delivers:** A salesperson records a human-led call, written notes, outcome and next action on the right Opportunity.

25. **[#27: Configure sending identities and reply readiness](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/27)** (T25)

- **Blocked by:** [#4](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/4), [#17](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/17).
- **Delivers:** A Business sees whether each connected-mailbox, customer-domain or service-provided sender is eligible and ready for its intended use.

26. **[#28: Select mailbox processing scope and optional history](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/28)** (T26)

- **Blocked by:** [#27](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/27).
- **Delivers:** A Business chooses which sales mail is processed and explicitly opts into a bounded historical import.

27. **[#29: Synchronize selected Gmail conversations](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/29)** (T27)

- **Blocked by:** [#19](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/19), [#28](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/28).
- **Delivers:** A Business connects Gmail and sees selected inquiries and manual replies synchronize into its sales workflow.

28. **[#30: Synchronize selected Microsoft mailbox conversations](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/30)** (T28)

- **Blocked by:** [#19](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/19), [#28](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/28).
- **Delivers:** A Business connects Outlook/Microsoft mail and sees selected inquiries and manual replies reflected in the sales workflow.

29. **[#31: Enforce email eligibility and outreach suppression](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/31)** (T29)

- **Blocked by:** [#19](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/19), [#27](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/27).
- **Delivers:** A Business sees whether a proposed email is eligible, and opt-outs immediately prevent covered outreach.

30. **[#32: Approve a bounded first-outreach campaign](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/32)** (T30)

- **Blocked by:** [#9](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/9), [#11](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/11), [#31](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/31).
- **Delivers:** An owner reviews and approves a fixed recipient set, initial messages and bounded follow-up sequence before first contact.

31. **[#33: Hand off a reviewed email to the user's own client](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/33)** (T31)

- **Blocked by:** [#32](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/32).
- **Delivers:** A user opens, copies or downloads an approved draft and sees preparation and later sending evidence accurately distinguished.

32. **[#34: Dispatch approved email sequences with durable recovery](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/34)** (T32)

- **Blocked by:** [#28](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/28), [#32](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/32).
- **Delivers:** An approved email sequence runs on schedule and stops safely on replies, opt-outs, takeover or lost readiness.

33. **[#35: Send and observe mail from a connected Gmail identity](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/35)** (T33)

- **Blocked by:** [#29](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/29), [#34](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/34).
- **Delivers:** Approved application actions send from the Business's Gmail account and display honest provider/sent-folder evidence.

34. **[#36: Send and observe mail from a connected Microsoft identity](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/36)** (T34)

- **Blocked by:** [#30](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/30), [#34](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/34).
- **Delivers:** Approved application actions send through the Business's Microsoft mailbox with correlated and accurately labeled observations.

35. **[#37: Pause unhealthy senders and guide recovery](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/37)** (T35)

- **Blocked by:** [#34](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/34).
- **Delivers:** The Business and operator see sender-specific authentication, bounce or complaint failures and recover safely without losing inbound work.

36. **[#38: Onboard a customer-owned WhatsApp identity](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/38)** (T36)

- **Blocked by:** [#27](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/27).
- **Delivers:** A Business connects its own Meta account and number, sees supported coexistence/readiness and understands its separate Meta bill.

37. **[#39: Receive WhatsApp inquiries and supported manual activity](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/39)** (T37)

- **Blocked by:** [#20](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/20), [#38](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/38).
- **Delivers:** WhatsApp inquiries enter the shared sales workflow and supported manual app replies hand control to the salesperson.

38. **[#40: Send approved WhatsApp messages within channel rules](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/40)** (T38)

- **Blocked by:** [#34](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/34), [#39](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/39).
- **Delivers:** A Business sends eligible WhatsApp conversation or approved outreach messages under permission, template and service-window rules.

39. **[#41: Maintain a Business billing profile and tax evidence](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/41)** (T39)

- **Blocked by:** [#4](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/4), [#8](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/8).
- **Delivers:** An authorized Business user saves legal billing details and supporting evidence used for its subscription invoices.

40. **[#42: Quote configured reach, allowances and optional capacity](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/42)** (T40)

- **Blocked by:** [#6](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/6), [#41](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/41).
- **Delivers:** A Business reviews a priced subscription quote for its reach and automation capacity with Meta charges disclosed separately.

41. **[#43: Calculate subscription tax from approved rules and evidence](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/43)** (T41)

- **Blocked by:** [#41](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/41).
- **Delivers:** An operator configures supported tax treatment and a Business sees a calculated or review-required subscription total.

42. **[#44: Purchase a subscription from confirmed payment events](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/44)** (T42)

- **Blocked by:** [#42](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/42), [#43](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/43).
- **Delivers:** A Business completes hosted checkout and receives paid access only after authoritative, reconciled payment confirmation.

43. **[#45: Integrate Razorpay recurring cards in INR and USD](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/45)** (T43)

- **Blocked by:** [#44](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/44).
- **Delivers:** Eligible Businesses purchase and renew card subscriptions through the selected Razorpay gateway and see supported-method readiness.

44. **[#46: Recover failed renewals and manage cancellation](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/46)** (T44)

- **Blocked by:** [#44](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/44).
- **Delivers:** A Business sees failed-payment status, updates its payment method and renews or cancels under explicitly configured lifecycle rules.

45. **[#47: Apply approved reach upgrades and renewal-time downgrades](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/47)** (T45)

- **Blocked by:** [#46](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/46).
- **Delivers:** A Business approves a prorated expansion and receives it after payment, while reductions take effect at renewal without deleting sales history.

46. **[#48: Issue immutable invoices and credit notes](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/48)** (T46)

- **Blocked by:** [#44](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/44).
- **Delivers:** A Business downloads numbered seller invoices and applicable credit notes whose original amounts and tax evidence remain intact.

47. **[#49: Resolve refunds and disputes with financial adjustments](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/49)** (T47)

- **Blocked by:** [#46](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/46), [#48](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/48).
- **Delivers:** An operator processes a full/partial refund or dispute and the Business sees linked payment, document and subscription consequences.

48. **[#50: Reconcile subscription money through bank settlement](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/50)** (T48)

- **Blocked by:** [#49](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/49).
- **Delivers:** An operator reconciles invoices and gross payments through fees, refunds, tax, FX, settlements and bank receipts.

49. **[#51: Prepare tax periods and review liability reports](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/51)** (T49)

- **Blocked by:** [#49](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/49).
- **Delivers:** A platform operator manages tax obligations, due periods and reviewable liability reports from retained subscription transactions.

50. **[#52: Record tax filing and remittance confirmations](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/52)** (T50)

- **Blocked by:** [#51](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/51).
- **Delivers:** An authorized operator exports a reviewed period and records supported filing/payment confirmations with retained evidence.

51. **[#53: Report discovery quality and sales outcomes honestly](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/53)** (T51)

- **Blocked by:** [#12](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/12), [#22](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/22), [#23](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/23), [#26](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/26), [#37](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/37), [#40](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/40).
- **Delivers:** A Business reviews discovery quality, engagement, conversion outcomes, communication health and human effort without inflated counts.

52. **[#54: Track operator costs and alert on global budgets](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/54)** (T52)

- **Blocked by:** [#15](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/15), [#44](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/44).
- **Delivers:** An operator sees cross-provider spend and a month-end forecast with configurable global/category alerts.

53. **[#55: Inspect failures, action history and safe recovery](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/55)** (T53)

- **Blocked by:** [#14](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/14), [#34](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/34).
- **Delivers:** Authorized users inspect failed runs/actions, understand their policy context and recover safe work without duplicate external effects.

54. **[#56: Export retained data and offboard Business connections](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/56)** (T54)

- **Blocked by:** [#12](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/12), [#28](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/28), [#46](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/46), [#48](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/48).
- **Delivers:** A Business exports permitted records and offboards under explicit retention/cancellation policies without losing protected financial history or leaking credentials.

55. **[#57: Purchase and schedule reserved discovery capacity](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/57)** (T55)

- **Blocked by:** [#14](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/14), [#44](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/44).
- **Delivers:** A Business with the configured paid entitlement uses reserved capacity while pooled execution remains the default.

56. **[#58: Recover an isolated Business after infrastructure failure](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/58)** (T56)

- **Blocked by:** [#55](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/55), [#56](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/56).
- **Delivers:** An operator deploys the selected stack and demonstrates recovery of a Business's records and durable work in an isolated environment.

57. **[#59: Deliver authentication and platform notices through Resend](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/59)** (T57)

- **Blocked by:** [#4](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/4).
- **Delivers:** Users receive authorized authentication, invitation and platform notices through the selected transactional stream with visible delivery/setup status.

58. **[#60: Prepare paid pilots, enforce preflight and record renewal](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/60)** (T58)

- **Blocked by:** [#5](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/5), [#16](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/16), [#45](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/45), [#53](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/53), [#54](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/54), [#58](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/58), [#59](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/59).
- **Delivers:** An operator prepares a bounded paid pilot, sees missing live prerequisites and records measured results, paid renewal and a contrasting second workflow.

59. **[#61: Validate the separate UPI AutoPay mandate-change flow](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/61)** (T59)

- **Blocked by:** [#45](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/45), [#47](https://github.com/Tauqeer-Ahmed-99/lead-follow-up-and-booking-automation/issues/47).
- **Delivers:** An operator validates the separate UPI upgrade/new-mandate path before optionally enabling UPI AutoPay for eligible subscriptions.
