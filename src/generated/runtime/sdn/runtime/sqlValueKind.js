var sqlValueKind = /* @__PURE__ */ ((sqlValueKind2) => {
  sqlValueKind2[sqlValueKind2["Null"] = 0] = "Null";
  sqlValueKind2[sqlValueKind2["Bool"] = 1] = "Bool";
  sqlValueKind2[sqlValueKind2["I64"] = 2] = "I64";
  sqlValueKind2[sqlValueKind2["F64"] = 3] = "F64";
  sqlValueKind2[sqlValueKind2["Str"] = 4] = "Str";
  sqlValueKind2[sqlValueKind2["Bytes"] = 5] = "Bytes";
  return sqlValueKind2;
})(sqlValueKind || {});
export {
  sqlValueKind
};
