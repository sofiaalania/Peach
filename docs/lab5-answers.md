# Lab 5: Part 3, Step 7 Written Answers

### Question 1
**"The mailer got the same ObjectCreated event twice, and the person got two identical emails. Where would you store 'this report was already sent', and what would the key be?"**

**Answer:**
We would store this deduplication record in **DynamoDB** (or a Redis/ElastiCache cluster with TTL, or a `sent_reports` table in PostgreSQL).
- **Partition Key**: The S3 object key or hash, e.g. `report_key = "reports/2026-W41.csv"`.
- **Mechanism**: Before sending the email, the mailer performs an atomic conditional write in DynamoDB:
  `PutItem` with `ConditionExpression="attribute_not_exists(report_key)"` and a TTL attribute (e.g. 30 days).
- If the item already exists, DynamoDB throws `ConditionalCheckFailedException`, and the mailer immediately returns success without sending a duplicate email. This makes the mailer idempotent.

---

### Question 2
**"The builder in the VPC could not reach SES. List three ways to fix that, with their monthly cost: a NAT gateway, a VPC interface endpoint for SES, and the split you built. Which would you choose with ten more emails a week? With a million?"**

**Answer:**
1. **NAT Gateway**:
   - **Cost**: ~$32.40/month per AZ ($0.045/hour × 720h) + $0.045 per GB of data processed.
   - Allows Lambdas in private subnets to reach public internet endpoints, including SES.
2. **VPC Interface Endpoint (PrivateLink) for SES (`email-smtp` / SES)**:
   - **Cost**: ~$7.20/month per AZ ($0.01/hour × 720h), typically ~$14.40–$21.60/month across 2–3 AZs, plus $0.01 per GB processed.
   - Creates ENIs inside the VPC that route traffic directly to SES over AWS internal network.
3. **The split architecture (Builder in VPC + Mailer outside VPC via S3 & S3 Gateway Endpoint)**:
   - **Cost**: **$0.00/month base cost** (S3 Gateway VPC Endpoints are completely free; S3 event notifications are free; Lambda invocations are pay-per-millisecond).

- **With 10 more emails a week**:
  Choose the **split architecture** ($0.00 base cost). A NAT Gateway or Interface Endpoint would incur $15–$35/month in idle fixed baseline costs for negligible traffic.
- **With 1,000,000 emails a week**:
  Choose the **split architecture**. Decoupling report generation from delivery is an architectural best practice: the builder handles database workloads inside the VPC, while the mailer scales independently outside the VPC without consuming VPC IP addresses/ENIs or paying NAT data transfer penalties. SES charges $0.10/1,000 emails ($400/month), but the infrastructure pipeline itself remains pay-per-use with zero idle baseline overhead.

---

### Question 3
**"You could send a presigned S3 link instead of an attachment. A presigned URL signed with a Lambda role's temporary credentials stops working when those credentials expire, often within hours. How would you send a link that works for a week?"**

**Answer:**
Lambda execution credentials come from STS (AWS Security Token Service) and expire within minutes or hours (maximum 12 hours), so SigV4 presigned S3 URLs created with those credentials cannot outlive the STS token.
To send a link valid for a week:
1. **CloudFront Signed URLs (Best Practice)**: Put CloudFront in front of the private S3 bucket using Origin Access Control (OAC). Sign the URL using a CloudFront public/private key pair (CloudFront Key Group). CloudFront signed URLs do not depend on temporary IAM STS credentials and can be given an expiration date 7 days in the future (or longer).
2. **Dedicated IAM User Credentials (Alternative)**: Sign the presigned S3 URL using long-term credentials of an IAM service user (e.g., fetched from AWS Secrets Manager), which allows SigV4 expiration up to 604,800 seconds (7 days).
