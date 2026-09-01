# ==============================================================================
# Managed PostgreSQL RDS Multi-AZ Deployment with Read-Replica
# ==============================================================================

resource "aws_db_subnet_group" "db" {
  name       = "argus-${var.environment}-db-subnet-group"
  subnet_ids = aws_subnet.database[*].id

  tags = {
    Name = "argus-${var.environment}-db-subnet-group"
  }
}

resource "aws_security_group" "rds" {
  name        = "argus-${var.environment}-rds-sg"
  description = "Controls database access from private ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from ECS tasks"
    from_port       = 5432
    to_port         = 5432
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
    Name = "argus-${var.environment}-rds-sg"
  }
}

resource "aws_db_instance" "primary" {
  identifier                  = "argus-${var.environment}-primary-db"
  engine                      = "postgres"
  engine_version              = "15.5"
  instance_class              = var.db_instance_class
  allocated_storage           = 100
  max_allocated_storage       = 500
  storage_type                = "gp3"
  multi_az                    = true
  publicly_accessible        = false
  db_subnet_group_name        = aws_db_subnet_group.db.name
  vpc_security_group_ids      = [aws_security_group.rds.id]
  db_name                     = "argus"
  username                    = "argus_admin"
  manage_master_user_password = true
  backup_retention_period     = 30
  backup_window               = "03:00-04:00"
  maintenance_window          = "Sun:04:30-Sun:05:30"
  auto_minor_version_upgrade  = true
  deletion_protection         = var.environment == "prod"
  skip_final_snapshot         = var.environment != "prod"
  final_snapshot_identifier   = "argus-${var.environment}-final-snapshot"

  tags = {
    Name = "argus-${var.environment}-primary-db"
  }
}

# Regional Read-Replica for Explore Feeds and Read-Only Graph Scaling
resource "aws_db_instance" "replica" {
  identifier             = "argus-${var.environment}-read-replica"
  replicate_source_db    = aws_db_instance.primary.identifier
  instance_class         = var.db_instance_class
  publicly_accessible   = false
  vpc_security_group_ids = [aws_security_group.rds.id]
  auto_minor_version_upgrade = true
  skip_final_snapshot    = true

  tags = {
    Name = "argus-${var.environment}-read-replica"
  }
}
