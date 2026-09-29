"""Money, the way every finance record keeps it (#131).

An amount is an integer in its currency's minor unit -- cents, pence, fils --
and never a float. The currency travels with every amount, and nothing
anywhere converts one into another: SoftTrack records what was agreed, in the
currency it was agreed in, and an instance that pays in three currencies sees
three subtotals rather than one total in a rate nobody agreed to.
"""

import enum


class Currency(str, enum.Enum):
    """The ISO 4217 currencies an amount can be recorded in.

    A closed list rather than any three letters, so a typo is refused instead
    of becoming a currency of its own that every subtotal then carries.
    Adding one is a line here and one in MINOR_UNITS; the column is plain
    text, so it needs no migration.
    """

    AED = "AED"
    ARS = "ARS"
    AUD = "AUD"
    BDT = "BDT"
    BGN = "BGN"
    BHD = "BHD"
    BRL = "BRL"
    CAD = "CAD"
    CHF = "CHF"
    CLP = "CLP"
    CNY = "CNY"
    COP = "COP"
    CZK = "CZK"
    DKK = "DKK"
    EGP = "EGP"
    EUR = "EUR"
    GBP = "GBP"
    GHS = "GHS"
    HKD = "HKD"
    HUF = "HUF"
    IDR = "IDR"
    ILS = "ILS"
    INR = "INR"
    ISK = "ISK"
    JOD = "JOD"
    JPY = "JPY"
    KES = "KES"
    KRW = "KRW"
    KWD = "KWD"
    LKR = "LKR"
    MAD = "MAD"
    MXN = "MXN"
    MYR = "MYR"
    NGN = "NGN"
    NOK = "NOK"
    NZD = "NZD"
    OMR = "OMR"
    PEN = "PEN"
    PHP = "PHP"
    PKR = "PKR"
    PLN = "PLN"
    QAR = "QAR"
    RON = "RON"
    RSD = "RSD"
    SAR = "SAR"
    SEK = "SEK"
    SGD = "SGD"
    THB = "THB"
    TND = "TND"
    TRY = "TRY"
    TWD = "TWD"
    UAH = "UAH"
    USD = "USD"
    UYU = "UYU"
    VND = "VND"
    ZAR = "ZAR"


#: Digits after the decimal point, from ISO 4217: what turns "8,300.00" into
#: 830000 and back. Two unless listed here. The browser reads these from
#: GET /currencies rather than keeping a copy that could disagree.
_NOT_TWO = {
    Currency.CLP: 0,
    Currency.ISK: 0,
    Currency.JPY: 0,
    Currency.KRW: 0,
    Currency.VND: 0,
    Currency.BHD: 3,
    Currency.JOD: 3,
    Currency.KWD: 3,
    Currency.OMR: 3,
    Currency.TND: 3,
}
MINOR_UNITS: dict[Currency, int] = {
    currency: _NOT_TWO.get(currency, 2) for currency in Currency
}

#: The largest single amount accepted, in minor units: ten billion dollars'
#: worth of cents. A guard against a slipped finger, not a policy -- and it
#: keeps any realistic sum well inside the 2^53 a browser holds exactly.
MAX_AMOUNT_MINOR = 10**12
