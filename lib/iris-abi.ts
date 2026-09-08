// Generated from contracts/IrisCommitments.sol by `npm run compile`. Do not edit.
export const irisAbi = [
  {
    "inputs": [
      {
        "internalType": "contract IAUSD",
        "name": "token_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AlreadyCancelled",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AlreadyClaimed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AuthorizationNotBound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BadClaimSignature",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Completed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidSchedule",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotClaimed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotSender",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoteTooLong",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NothingDue",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ScheduleTooLong",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferFailed",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "refunded",
        "type": "uint256"
      }
    ],
    "name": "CommitmentCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "CommitmentClaimed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint128",
        "name": "amountPerPayment",
        "type": "uint128"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "interval",
        "type": "uint40"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "paymentsTotal",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "firstPaymentAt",
        "type": "uint40"
      }
    ],
    "name": "CommitmentCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "from",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "about",
        "type": "string"
      }
    ],
    "name": "CommitmentNoted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint128",
        "name": "amount",
        "type": "uint128"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "paymentsMade",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "nextPaymentAt",
        "type": "uint40"
      }
    ],
    "name": "PaymentReleased",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint128",
        "name": "amountPerPayment",
        "type": "uint128"
      },
      {
        "internalType": "uint40",
        "name": "interval",
        "type": "uint40"
      },
      {
        "internalType": "uint16",
        "name": "paymentsTotal",
        "type": "uint16"
      },
      {
        "internalType": "bool",
        "name": "startNow",
        "type": "bool"
      },
      {
        "internalType": "bytes32",
        "name": "note",
        "type": "bytes32"
      }
    ],
    "name": "authorizationNonce",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "cancel",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "claim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "count",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint128",
        "name": "amountPerPayment",
        "type": "uint128"
      },
      {
        "internalType": "uint40",
        "name": "interval",
        "type": "uint40"
      },
      {
        "internalType": "uint16",
        "name": "paymentsTotal",
        "type": "uint16"
      },
      {
        "internalType": "bool",
        "name": "startNow",
        "type": "bool"
      },
      {
        "components": [
          {
            "internalType": "string",
            "name": "from",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "about",
            "type": "string"
          }
        ],
        "internalType": "struct IrisCommitments.Note",
        "name": "note",
        "type": "tuple"
      }
    ],
    "name": "create",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "claimSigner",
        "type": "address"
      },
      {
        "internalType": "uint128",
        "name": "amountPerPayment",
        "type": "uint128"
      },
      {
        "internalType": "uint40",
        "name": "interval",
        "type": "uint40"
      },
      {
        "internalType": "uint16",
        "name": "paymentsTotal",
        "type": "uint16"
      },
      {
        "internalType": "bool",
        "name": "startNow",
        "type": "bool"
      },
      {
        "components": [
          {
            "internalType": "string",
            "name": "from",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "about",
            "type": "string"
          }
        ],
        "internalType": "struct IrisCommitments.Note",
        "name": "note",
        "type": "tuple"
      }
    ],
    "name": "createToClaim",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "claimSigner",
        "type": "address"
      },
      {
        "internalType": "uint128",
        "name": "amountPerPayment",
        "type": "uint128"
      },
      {
        "internalType": "uint40",
        "name": "interval",
        "type": "uint40"
      },
      {
        "internalType": "uint16",
        "name": "paymentsTotal",
        "type": "uint16"
      },
      {
        "internalType": "bool",
        "name": "startNow",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "validAfter",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "validBefore",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      },
      {
        "components": [
          {
            "internalType": "string",
            "name": "from",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "about",
            "type": "string"
          }
        ],
        "internalType": "struct IrisCommitments.Note",
        "name": "note",
        "type": "tuple"
      }
    ],
    "name": "createToClaimWithAuthorization",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint128",
        "name": "amountPerPayment",
        "type": "uint128"
      },
      {
        "internalType": "uint40",
        "name": "interval",
        "type": "uint40"
      },
      {
        "internalType": "uint16",
        "name": "paymentsTotal",
        "type": "uint16"
      },
      {
        "internalType": "bool",
        "name": "startNow",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "validAfter",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "validBefore",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      },
      {
        "components": [
          {
            "internalType": "string",
            "name": "from",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "about",
            "type": "string"
          }
        ],
        "internalType": "struct IrisCommitments.Note",
        "name": "note",
        "type": "tuple"
      }
    ],
    "name": "createWithAuthorization",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "domainSeparator",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "offset",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "dueBatch",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "ids",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256",
        "name": "examined",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "get",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "claimSigner",
            "type": "address"
          },
          {
            "internalType": "uint128",
            "name": "amountPerPayment",
            "type": "uint128"
          },
          {
            "internalType": "uint40",
            "name": "interval",
            "type": "uint40"
          },
          {
            "internalType": "uint40",
            "name": "nextPaymentAt",
            "type": "uint40"
          },
          {
            "internalType": "uint16",
            "name": "paymentsTotal",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "paymentsMade",
            "type": "uint16"
          },
          {
            "internalType": "bool",
            "name": "cancelled",
            "type": "bool"
          }
        ],
        "internalType": "struct IrisCommitments.Commitment",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "incomingOf",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "from",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "about",
            "type": "string"
          }
        ],
        "internalType": "struct IrisCommitments.Note",
        "name": "note",
        "type": "tuple"
      }
    ],
    "name": "noteHash",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "noteOf",
    "outputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "from",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "about",
            "type": "string"
          }
        ],
        "internalType": "struct IrisCommitments.Note",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "outgoingOf",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "releasable",
    "outputs": [
      {
        "internalType": "uint128",
        "name": "",
        "type": "uint128"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "id",
        "type": "uint256"
      }
    ],
    "name": "release",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "token",
    "outputs": [
      {
        "internalType": "contract IAUSD",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
