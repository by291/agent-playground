CREATE ROLE aegra LOGIN PASSWORD 'aegra';

CREATE SCHEMA aegra AUTHORIZATION aegra;

GRANT CONNECT ON DATABASE agent_playground TO aegra;

ALTER ROLE aegra IN DATABASE agent_playground SET search_path = aegra;
