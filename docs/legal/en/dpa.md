# VibeUs International Data Processing Addendum (DPA)

**Version:** 2026-09-03-international-1.0  
**Effective date:** 3 September 2026

This Data Processing Addendum (**“DPA”**) forms part of the VibeUs International Business Terms or another agreement that incorporates it (**“Agreement”**) when VibeUs processes personal data in Customer Content on documented instructions from the Customer.

## 1. Parties and roles

The **Customer** is the organisation, business, freelancer, or other professional customer that determines the purposes and essential means of processing personal data contained in Customer Content.

**VibeUs / Processor** is Alexey Valeryevich Platonov, Russian Federation, INN 213005986909, contact `privacy@vibeus.pro`.

The parties acknowledge that role allocation depends on the actual processing. VibeUs remains an independent controller/operator for its own account, billing, security, fraud-prevention, legal-compliance, and direct-support processing as described in the Privacy Notice.

## 2. Processing instructions and purpose

VibeUs processes Customer Personal Data only to provide, secure, maintain, and support the features requested by the Customer and in accordance with documented instructions contained in the Agreement, product configuration, API/CLI requests, and written support instructions.

Processing may include receiving feedback, attaching page/element context, storing project/task content, displaying data to authorised Customer users, processing sanitised runtime diagnostics, synchronising with Customer-configured developer tools, and deleting/exporting data as instructed.

If VibeUs reasonably believes an instruction violates applicable law or creates a material security risk, VibeUs may suspend that instruction while requesting clarification, unless prohibited by law from doing so.

## 3. Processing details

**Duration:** for the term of the Agreement plus the deletion/backup periods stated in the Retention Policy and any mandatory legal retention.

**Data subjects may include:** Customer personnel and contractors; users/testers/reviewers; visitors to Customer websites or applications who submit feedback; and other individuals whose information the Customer lawfully includes in Customer Content.

**Data may include:** feedback text; names/pseudonyms; voluntary contact details; URLs/routes; element locator/text/geometry; viewport/device/browser context; screenshots if enabled; comments and engineering-task content; sanitised runtime event metadata, routes, request IDs and stack data; project/session identifiers; and other fields expressly configured by the Customer.

**Excluded by default:** full payment-card credentials, CVC/CVV, plaintext passwords, authentication headers, private keys, special-category/sensitive personal data, biometric data, and raw request/response bodies. The Customer must not intentionally submit these categories unless VibeUs has expressly agreed in writing to the relevant processing and safeguards.

**Operations:** collection/receipt, recording, organisation, storage, retrieval, use, display, transmission to Customer-authorised recipients, restriction, deletion, destruction, and other operations necessary for the documented service.

## 4. Confidentiality

VibeUs limits access to Customer Personal Data to persons who need it to perform the service or protect it and who are subject to appropriate confidentiality duties.

## 5. Security

VibeUs maintains technical and organisational measures appropriate to the nature of the hosted developer service, including where applicable:

- authenticated account/session controls;
- role/capability authorisation and tenant-isolation checks;
- hashing/digest storage for secret tokens where feasible;
- encryption of integration secrets at rest;
- separation of Live Preview from the primary account origin;
- rate limits and abuse controls;
- minimisation/sanitisation of diagnostic payloads;
- security/audit logging;
- backup and recovery controls; and
- automated security, migration, billing-integrity, and release gates.

Public documentation intentionally does not disclose secrets or internal details that would weaken security. Additional reasonable security information may be provided under appropriate confidentiality arrangements.

## 6. Subprocessors

The Customer gives general authorisation for VibeUs to use subprocessors necessary to provide the service, subject to this section.

The current list is published at `/legal/subprocessors`. VibeUs will publish material additions or replacements before the new subprocessor receives Customer Personal Data where reasonably practicable. For a subprocessor that materially affects Customer Personal Data, the target advance notice is at least 10 calendar days unless urgent security, legal, or provider circumstances make advance notice impracticable.

VibeUs will impose data-protection/confidentiality obligations on subprocessors appropriate to the processing and remains responsible for its own obligations under this DPA.

A payment provider that independently determines payment-processing purposes may act as an independent controller rather than a subprocessor for that payment activity; the Subprocessor Notice identifies the role where known.

## 7. International transfers and territorial restrictions

The current international hosted launch does not intentionally offer new hosted accounts or paid hosted checkout to the EEA or United Kingdom. Customers must not use the current international hosted service to create a restricted transfer of EEA/UK personal data to VibeUs.

If VibeUs later enables EEA/UK hosted availability, any transfer of personal data subject to EEA/UK restricted-transfer rules will require the parties to implement the then-applicable transfer mechanism (for example, appropriate Standard Contractual Clauses and/or UK IDTA/Addendum), supplementary measures and transfer-risk assessment where required **before** that data flow starts.

For other jurisdictions, the Customer is responsible for identifying restrictions applicable to its export of Customer Personal Data, and VibeUs will provide reasonable cooperation concerning the service-side transfer path.

For Russian personal-data flows, VibeUs applies the localisation and cross-border procedures described in the Russian Privacy Policy and applicable Russian law.

## 8. Data-subject requests

If VibeUs receives a request from an individual relating primarily to Customer Personal Data for which the Customer is controller/operator, VibeUs will, where legally permitted, direct the individual to the Customer and notify the Customer when reasonably identifiable.

Taking into account the nature of processing, VibeUs will provide reasonable technical assistance available through the product or support to help the Customer respond to access, correction, deletion, restriction, portability, or objection requests required by applicable law.

## 9. Security incidents

VibeUs will notify the Customer **without undue delay** after confirming a personal-data breach affecting Customer Personal Data for which VibeUs acts as processor. The operational target is within 24 hours after confirmation where reasonably possible.

Information will be supplied as it becomes available and may include the nature of the incident, affected data/categories, likely consequences, containment/remediation measures, and a contact point. VibeUs may provide information in phases rather than delay the initial notice until every fact is known.

This notice does not constitute an admission of fault or legal liability.

## 10. Return and deletion

During the service, the Customer may use available export/delete functionality. Following termination or a valid deletion instruction, VibeUs will delete or de-identify active Customer Personal Data within the periods in the Retention Policy, normally no later than 30 calendar days for active-service copies, unless law requires retention.

Residual backups expire through the standard backup rotation, currently up to 30 days. Mandatory tax/payment/security/dispute records may be retained only for the applicable purpose and period.

## 11. Audit and information

On reasonable written request, VibeUs will provide information necessary to demonstrate compliance with this DPA, taking into account the size and nature of the service. Audit requests must not compromise other customers, security secrets, privileged information, or production availability.

If documentary evidence is insufficient and applicable law requires an audit, the parties will agree a reasonable scope, timing, confidentiality arrangement, and cost allocation. Audits should normally occur no more than once per 12 months unless a confirmed incident or regulator requirement justifies more frequent review.

## 12. Customer obligations

The Customer is responsible for:

- having lawful purposes and legal bases for Customer Personal Data;
- giving required notices and obtaining required consents;
- configuring data collection and integrations appropriately;
- limiting users and permissions;
- avoiding prohibited/high-risk data categories unless expressly agreed;
- responding to data-subject requests as controller/operator; and
- complying with transfer, sector, employment, confidentiality, and other laws applicable to the Customer's use.

## 13. Conflict and termination

If this DPA conflicts with the Agreement on processing of Customer Personal Data, this DPA prevails for that processing. Mandatory data-protection law and an executed transfer instrument prevail to the extent legally required.

The DPA terminates when VibeUs no longer processes Customer Personal Data on the Customer's behalf, subject to surviving confidentiality, security, deletion, and legal-retention obligations.

## 14. Contact

Privacy and DPA: `privacy@vibeus.pro`  
Security incidents: `security@vibeus.pro`  
Legal: `legal@vibeus.pro`
