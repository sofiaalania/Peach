#!/usr/bin/env bash
# Deploy Lab 5 Reports pipeline:
# 1. Reports S3 Bucket + S3 Gateway Endpoint
# 2. SQS Queue + DLQ
# 3. Report Builder Lambda (in VPC, DB password resolved directly from Secrets Manager)
# 4. EventBridge Scheduler (cron every Monday at 07:00 Europe/Kyiv)
# 5. Report Mailer Lambda (outside VPC) + S3 Event notification
# 6. SES Email Identity
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="${ROOT}/infra/reports.yaml"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

PROJECT_NAME="${PROJECT_NAME:-peach}"
STACK_NAME="${PROJECT_NAME}-reports"
AWS_REGION="${AWS_REGION:-eu-central-1}"
export AWS_DEFAULT_REGION="${AWS_REGION}"

[[ -n "${EMAIL:-}" ]] || die "Please provide EMAIL=<your-email@example.com>, e.g. make deploy-reports EMAIL=user@example.com"

log "Fetching backend image information..."
IMAGE_URI="$(aws lambda get-function-configuration --function-name "${PROJECT_NAME}-backend" --region "${AWS_REGION}" --query "Code.ImageUri" --output text)"

PARAMS_FILE="$(mktemp /tmp/peach-reports-params-XXXXXX.json)"
trap 'rm -f "${PARAMS_FILE}"' EXIT

python3 - "${PARAMS_FILE}" <<PY
import json, sys
params = [
    {"ParameterKey": "ProjectName", "ParameterValue": "${PROJECT_NAME}"},
    {"ParameterKey": "ImageUri", "ParameterValue": "${IMAGE_URI}"},
    {"ParameterKey": "SenderEmail", "ParameterValue": "${EMAIL}"},
    {"ParameterKey": "RecipientEmail", "ParameterValue": "${EMAIL}"},
]
with open(sys.argv[1], "w") as f:
    json.dump(params, f)
PY

PARAMS_FILE_AWS="${PARAMS_FILE}"
if command -v cygpath >/dev/null 2>&1; then
  PARAMS_FILE_AWS="$(cygpath -w "${PARAMS_FILE}")"
fi

log "Deploying CloudFormation stack ${STACK_NAME} in ${AWS_REGION}..."
aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "file://${PARAMS_FILE_AWS}" \
  --region "${AWS_REGION}" \
  --no-fail-on-empty-changeset

log "Reports stack deployed successfully!"
REPORTS_BUCKET="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --region "${AWS_REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='ReportsBucketName'].OutputValue" --output text)"
QUEUE_URL="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" --region "${AWS_REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='ReportRequestsQueueUrl'].OutputValue" --output text)"

log "Reports Bucket: s3://${REPORTS_BUCKET}"
log "SQS Queue: ${QUEUE_URL}"
log "SES Identity created for ${EMAIL}. Please check your inbox and confirm the verification email if prompted."
