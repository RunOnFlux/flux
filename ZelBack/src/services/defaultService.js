function defaultResponse(req, res) {
  const successMessage = {
    status: 'success',
    data: {
      message: 'Welcome to ZelNode network!'
    }
  }
  return res.json(successMessage)
}

module.exports = {
  defaultResponse: defaultResponse
}
