-- pg_cron is already installed in this project. No extension or paid service.
select cron.schedule('sma-wordpress-ticket-cleanup','*/5 * * * *',
 'select sma_private.wordpress_ticket_cleanup_v1()');
