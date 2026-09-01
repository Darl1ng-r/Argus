variable "aws_region" {
  type        = string
  description = "AWS deployment region"
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment name (e.g. prod, staging)"
  default     = "prod"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC"
  default     = "10.0.0.0/16"
}

variable "app_port" {
  type        = number
  description = "API container port"
  default     = 4000
}

variable "db_instance_class" {
  type        = string
  description = "RDS instance size"
  default     = "db.r6g.large"
}

variable "redis_node_type" {
  type        = string
  description = "ElastiCache Redis node type"
  default     = "cache.r6g.large"
}
