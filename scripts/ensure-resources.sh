#!/bin/bash
# ensure-resources.sh
# This script checks for the existence of required AWS resources
# and creates them if they don't exist before CDK deployment

set -e  # Exit on any error

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region)
STACK_NAME="MineCloud"

echo "🔍 Checking for required AWS resources..."
echo "Account: $ACCOUNT_ID"
echo "Region: $REGION"

# ---------------------------------------------
# Check for the S3 bucket
# ---------------------------------------------
BUCKET_NAME="$(echo $STACK_NAME | tr '[:upper:]' '[:lower:]')-backups-$ACCOUNT_ID"
BUCKET_EXISTS=$(aws s3api head-bucket --bucket "$BUCKET_NAME" 2>&1 || true)

if [[ $BUCKET_EXISTS == *"404"* ]]; then
  echo "Creating S3 bucket: $BUCKET_NAME"
  aws s3 mb "s3://$BUCKET_NAME"
  echo "✅ Bucket created"
else
  echo "✅ Bucket exists: $BUCKET_NAME"
fi

# ---------------------------------------------
# Check for the key pair
# ---------------------------------------------
KEY_PAIR_NAME="${STACK_NAME}_ec2_key"
KEY_PAIR_EXISTS=$(aws ec2 describe-key-pairs --key-names "$KEY_PAIR_NAME" 2>&1 || true)

if [[ $KEY_PAIR_EXISTS == *"InvalidKeyPair.NotFound"* ]]; then
  echo "Creating key pair: $KEY_PAIR_NAME"
  KEY_MATERIAL=$(aws ec2 create-key-pair --key-name "$KEY_PAIR_NAME" --query 'KeyMaterial' --output text)
  
  # Save the private key
  KEY_FILE="${KEY_PAIR_NAME}.pem"
  echo "$KEY_MATERIAL" > "$KEY_FILE"
  chmod 400 "$KEY_FILE"
  
  echo "✅ Key pair created and saved to $KEY_FILE (keep this file safe for SSH access)"
else
  echo "✅ Key pair exists: $KEY_PAIR_NAME"
fi

# ---------------------------------------------
# Check for the security group
# ---------------------------------------------
SG_NAME="${STACK_NAME}_ec2_security_group"
SG_EXISTS=$(aws ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" --query "SecurityGroups[0].GroupId" --output text 2>&1 || true)

if [[ $SG_EXISTS == "None" || $SG_EXISTS == *"InvalidGroup.NotFound"* ]]; then
  # Get default VPC ID
  DEFAULT_VPC_ID=$(aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text)
  
  if [[ -z $DEFAULT_VPC_ID || $DEFAULT_VPC_ID == "None" ]]; then
    echo "❌ Error: No default VPC found. Please create a default VPC first."
    exit 1
  fi
  
  echo "Creating security group: $SG_NAME in VPC $DEFAULT_VPC_ID"
  SG_ID=$(aws ec2 create-security-group --group-name "$SG_NAME" --description "Security group for $STACK_NAME server" --vpc-id "$DEFAULT_VPC_ID" --query "GroupId" --output text)
  
  # Add SSH access
  echo "Adding SSH access to security group"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22 --cidr 0.0.0.0/0
  
  # Add Minecraft port
  echo "Adding Minecraft port to security group"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 25565 --cidr 0.0.0.0/0
  
  echo "✅ Security group created: $SG_ID"
else
  echo "✅ Security group exists: $SG_EXISTS"
fi

# ---------------------------------------------
# Check for Route53 domain if specified
# ---------------------------------------------
DOMAIN_NAME=$(grep -o "DOMAIN_NAME.*=.*'[^']*'" ../MineCloud-Service-Info.ts 2>/dev/null | cut -d "'" -f 2 || echo "")

if [[ ! -z "$DOMAIN_NAME" ]]; then
  HOSTED_ZONE_EXISTS=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN_NAME" --query "HostedZones[?Name=='$DOMAIN_NAME.'].Id" --output text)
  
  if [[ -z $HOSTED_ZONE_EXISTS || $HOSTED_ZONE_EXISTS == "None" ]]; then
    echo "⚠️ Warning: Domain $DOMAIN_NAME doesn't have a hosted zone in Route53."
    echo "⚠️ If you intend to use DNS features, please set up your domain in Route53 first."
  else
    echo "✅ Route53 hosted zone exists for domain: $DOMAIN_NAME"
  fi
fi

echo ""
echo "🚀 All required resources are ready. You can now run 'cdk deploy'."
