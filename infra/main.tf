terraform {
  required_providers { aws = { source = "hashicorp/aws", version = "~> 5.0" } }
}
variable "region"      { default = "us-east-1" }
variable "db_password" { sensitive = true }
provider "aws" { region = var.region }

resource "aws_s3_bucket" "uploads" { bucket_prefix = "vault-uploads-" }
resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_vpc" "default" { default = true }
resource "aws_security_group" "db" {
  name_prefix = "vault-db-"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.default.cidr_block]
  }
}
resource "aws_db_instance" "vault" {
  identifier             = "vault"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t4g.micro"
  allocated_storage      = 20
  db_name                = "vault"
  username               = "vault"
  password               = var.db_password
  vpc_security_group_ids = [aws_security_group.db.id]
  storage_encrypted      = true
  skip_final_snapshot    = true
}
output "db_endpoint" { value = aws_db_instance.vault.endpoint }
output "bucket"      { value = aws_s3_bucket.uploads.bucket }
