output "alb_dns_name" {
  description = "Application Load Balancer Public DNS name"
  value       = aws_lb.main.dns_name
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "rds_primary_endpoint" {
  description = "Primary PostgreSQL RDS write endpoint"
  value       = aws_db_instance.primary.endpoint
}

output "rds_replica_endpoint" {
  description = "Read-replica PostgreSQL RDS endpoint"
  value       = aws_db_instance.replica.endpoint
}

output "redis_primary_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}
