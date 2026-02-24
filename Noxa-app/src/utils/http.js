export const createError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const sendList = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({ data });
};

export const sendItem = (res, data, statusCode = 200) => {
  return res.status(statusCode).json({ data });
};
