# Reject nested agent requests when capacity is full

An agent can request another agent through Impulse, but a nested request receives an immediate capacity error when the configured agent limit is full; independent requests continue to queue. This prevents all slots being occupied by parents waiting for children that cannot start, without exceeding the limit or requiring portable suspension of arbitrary harnesses. The tradeoff is rejecting some nested requests during temporary saturation, leaving the requesting agent to handle the error.
