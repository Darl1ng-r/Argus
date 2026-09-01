# ==============================================================================
# Managed Redis ElastiCache Replication Group with Multi-AZ Automated Failover
# ==============================================================================

resource "aws_elasticache_subnet_group" "redis" {
  name       = "argus-${var.environment}-redis-subnet-group"
  subnet_ids = aws_subnet.database[*].id

  tags = {
    Name = "argus-${var.environment}-redis-subnet-group"
  }
}

resource "aws_security_group" "redis" {
  name        = "argus-${var.environment}-redis-sg"
  description = "Controls Redis access from private ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "argus-${var.environment}-redis-sg"
  }
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id          = "argus-${var.environment}-redis"
  description                   = "High availability Redis cluster for caching, rate-limiting, and SSE fan-out"
  node_type                     = var.redis_node_type
  num_cache_clusters            = 2
  port                          = 6379
  parameter_group_name          = "default.redis7"
  subnet_group_name             = aws_elasticache_subnet_group.redis.name
  security_group_ids            = [aws_security_group.redis.id]
  automatic_failover_enabled    = true
  multi_az_enabled              = true
  at_rest_encryption_enabled    = true
  transit_encryption_enabled    = true
  apply_immediately             = false
  maintenance_window            = "sun:06:00-sun:07:00"
  snapshot_retention_limit      = 7
  snapshot_window               = "05:00-06:00"

  tags = {
    Name = "argus-${var.environment}-redis"
  }
}
