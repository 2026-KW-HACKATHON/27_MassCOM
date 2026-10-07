function allowUiPreview(flag, variant) {
  return (
    flag === "1" &&
    (variant === undefined || variant === "" || variant === "development")
  );
}
module.exports = { allowUiPreview };
