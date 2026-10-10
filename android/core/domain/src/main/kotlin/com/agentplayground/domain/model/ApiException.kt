package com.agentplayground.domain.model

import java.io.IOException

/** A server rejection shared by transport, recovery and revision-conflict presentation. */
class ApiException(val status: Int, message: String) : IOException(message)
