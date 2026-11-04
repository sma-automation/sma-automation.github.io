import {createTicketHandler} from '../sma-wordpress-connect/handler.mjs';
import {serviceRpc} from '../sma-wordpress-connect/runtime.ts';
// No JWT: the 256-bit ticket only reveals its bound public approval data.
// It cannot confirm a connection, read a private key or write a WordPress page.
Deno.serve(createTicketHandler({serviceRpc}));
